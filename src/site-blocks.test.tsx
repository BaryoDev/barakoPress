import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The navigation and logo blocks (#167): the built-in header's parts, for a header region.
 */

let requestHeaders: Headers | null = null;
let pathname = "/";
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
    usePathname: () => pathname,
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { applySiteSettings } = await import("./site.js");
const { createSiteLayout } = await import("./screens/site-layout.js");
const { createBlockRegistry, registryFor } = await import("./blocks/registry.js");

const CMS = "http://cms.test";

const RECIPES = {
    track: { class: "track", style: { background: "#eef", "border-radius": "999px" } },
    pill: { class: "pill", style: { padding: "6px 12px" } },
    raised: { class: "raised", style: { "box-shadow": "0 1px 2px #0003" } },
    mine: { class: "mine", style: { padding: "2px" } },
    mark: { class: "mark", style: { gap: "4px" } },
};

const HEADER_BLOCKS = [
    { type: "siteLogo", props: {} },
    { type: "siteNavigation", props: {} },
];

type Tenant = { host: string; settings: Record<string, unknown>; header?: unknown[] };

const TENANTS: Record<string, Tenant> = {
    acme: {
        host: "acme.example",
        settings: {
            Name: "Acme",
            Url: "https://acme.example",
            Logo: "https://cdn.example/acme.svg",
            LogoAlt: "Acme home",
            HeaderPath: "/site/header",
            StyleRecipes: RECIPES,
            HeaderRecipes: { links: "track", link: "pill", current: "raised", brand: "mark" },
            HeaderLinks: [
                { label: "Docs", href: "/docs", activeOn: "/docs" },
                {
                    label: "Products",
                    href: "/products",
                    children: [{ label: "Engine", href: "/products/engine", activeOn: "/products/engine" }],
                },
                { label: "Blog", href: "/blog", badge: "NEW" },
            ],
        },
        header: HEADER_BLOCKS,
    },
    // No logo, no recipes, and links that never follow the path.
    bare: {
        host: "bare.example",
        settings: {
            Name: "Bare Co",
            Url: "https://bare.example",
            HeaderPath: "/site/header",
            HeaderLinks: [{ label: "About", href: "/about" }],
        },
        header: HEADER_BLOCKS,
    },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        if (url.pathname === "/api/public/site") {
            return Response.json({
                items: [{ id: "s", data: t.settings }],
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
            });
        }
        if (url.pathname === "/api/public/pages/resolve" && url.searchParams.get("path") === "/site/header" && t.header) {
            return Response.json({
                contract: 2,
                path: "/site/header",
                entry: { contentType: "page", id: "h", slug: "header", data: { Title: "Header", Blocks: t.header } },
                breadcrumbs: [],
            });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });

async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

async function headerAt(host: string, path: string): Promise<string> {
    requestHeaders = new Headers({ host });
    pathname = path;
    const Layout = createSiteLayout(config, { loadFonts: false });
    const html = await render(await Layout({ children: <p>the page</p> }));
    const body = html.indexOf("<body");
    return html.slice(html.indexOf(">", body) + 1, html.indexOf("<main>"));
}

function tagsWith(html: string, attr: string): string[] {
    return [...html.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(attr));
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    pathname = "/";
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the navigation block in a header region", () => {
    it("draws the site's header links in a named navigation", async () => {
        const header = await headerAt("acme.example", "/");
        expect(header).toContain('data-press="header"');
        const nav = tagsWith(header, 'data-press="site-navigation"');
        expect(nav).toHaveLength(1);
        expect(nav[0]).toMatch(/^<nav\b/);
        expect(nav[0]).toContain('aria-label="Menu"');
        for (const href of ["/docs", "/products", "/products/engine", "/blog"]) {
            expect(tagsWith(header, `href="${href}"`)).toHaveLength(1);
        }
        expect(header).toContain(">NEW<");
    });

    it("marks the current link by its activeOn", async () => {
        const current = tagsWith(await headerAt("acme.example", "/docs/intro"), 'aria-current="page"');
        expect(current).toHaveLength(1);
        expect(current[0]).toContain('href="/docs"');
        expect(current[0]).toContain("bp-current");
    });

    it("draws children as the header's dropdown, with the rules that open it", async () => {
        const header = await headerAt("acme.example", "/");
        const buttons = tagsWith(header, "aria-expanded");
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toContain('aria-label="Products links"');
        expect(header).toContain(".bp-dropdown>ul{display:none}");
        expect(header).toContain(".bp-current{font-weight:700}");
    });

    it("wears the recipes the site set for the header when it names none of its own", async () => {
        const header = await headerAt("acme.example", "/docs");
        const nav = tagsWith(header, 'data-press="site-navigation"');
        expect(nav).toHaveLength(1);
        expect(nav[0]).toContain('class="track"');
        const blog = tagsWith(header, 'href="/blog"');
        expect(blog).toHaveLength(1);
        expect(blog[0]).toContain('class="pill"');
        const docs = tagsWith(header, 'href="/docs"');
        expect(docs).toHaveLength(1);
        expect(docs[0]).toContain('class="bp-current raised"');
    });

    it("takes a recipe of its own over the site's", async () => {
        const blocks = TENANTS.acme.header;
        TENANTS.acme.header = [{ type: "siteNavigation", props: { linkRecipe: "mine", label: "Main" } }];
        try {
            const header = await headerAt("acme.example", "/");
            const blog = tagsWith(header, 'href="/blog"');
            expect(blog).toHaveLength(1);
            expect(blog[0]).toContain('class="mine"');
            expect(tagsWith(header, 'aria-label="Main"')).toHaveLength(1);
        } finally {
            TENANTS.acme.header = blocks;
        }
    });

    it("writes no rules when no link follows the path", async () => {
        const header = await headerAt("bare.example", "/about");
        expect(tagsWith(header, 'href="/about"')).toHaveLength(1);
        expect(header).not.toContain("<style");
        expect(header).not.toContain("aria-current");
    });

    it("draws nothing on the holding page", async () => {
        const cfg = applySiteSettings({ ...config, tenant: "acme" }, TENANTS.acme.settings, null);
        const held = registryFor(cfg, createBlockRegistry(cfg), { holding: true }).get("siteNavigation");
        const live = registryFor(cfg, createBlockRegistry(cfg)).get("siteNavigation");
        expect(held).toBeDefined();
        expect(live).toBeDefined();
        const draw = (definition: typeof held) => definition!.component({ props: {}, slots: {}, theme: cfg.theme });
        expect(draw(held)).toBeNull();
        expect(draw(live)).not.toBeNull();
    });
});

describe("the logo block in a header region", () => {
    it("draws the logo linking home, named by its alt, in the site's brand recipe", async () => {
        const header = await headerAt("acme.example", "/blog");
        const logo = tagsWith(header, 'data-press="site-logo"');
        expect(logo).toHaveLength(1);
        expect(logo[0]).toContain('href="/"');
        expect(logo[0]).toContain('class="mark"');
        const img = tagsWith(header, 'src="https://cdn.example/acme.svg"');
        expect(img).toHaveLength(1);
        expect(img[0]).toContain('alt="Acme home"');
    });

    it("draws the name when the site has no logo", async () => {
        const header = await headerAt("bare.example", "/");
        const at = header.indexOf('data-press="site-logo"');
        expect(at).toBeGreaterThan(-1);
        expect(header.slice(at, header.indexOf("</a>", at))).toContain(">Bare Co");
        expect(tagsWith(header, "<img")).toEqual([]);
    });

    it("draws both with the image as decoration, so the name is read once", async () => {
        const blocks = TENANTS.acme.header;
        TENANTS.acme.header = [{ type: "siteLogo", props: { show: "both" } }];
        try {
            const header = await headerAt("acme.example", "/");
            const img = tagsWith(header, 'src="https://cdn.example/acme.svg"');
            expect(img).toHaveLength(1);
            expect(img[0]).toContain('alt=""');
            const at = header.indexOf('data-press="site-logo"');
            expect(header.slice(at, header.indexOf("</a>", at))).toMatch(/>Acme$/);
        } finally {
            TENANTS.acme.header = blocks;
        }
    });
});
