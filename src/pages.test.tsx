import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pages and navigation from the Pages module, on a request-time site with several tenants.
 * The request and its cookies are whatever the test says.
 */
let requestHeaders: Headers | null = null;
let requestCookies: Record<string, string> = {};
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({
        get: (name: string) => (name in requestCookies ? { name, value: requestCookies[name] } : undefined),
    }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT 307 ${to}`), { digest: `NEXT_REDIRECT;replace;${to};307;` });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT 308 ${to}`), { digest: `NEXT_REDIRECT;replace;${to};308;` });
    },
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
const { getNavigation, isReservedPath } = await import("./cms.js");
const { signShareCookie, SHARE_COOKIE } = await import("./site.js");
const { createPage, createPageMetadata, createPageStaticParams } = await import("./screens/page.js");
const { createSiteLayout } = await import("./screens/site-layout.js");
const { createSitemap } = await import("./routes/sitemap.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
type Config = ReturnType<typeof defineConfig>;

const CMS = "http://cms.test";
const SECRET = "a-preview-secret-for-tests-only-0123456789";

type PageFixture = { entry: Record<string, unknown>; breadcrumbs?: unknown[]; contract?: number };
type Tenant = {
    host: string;
    settings: Record<string, unknown>;
    navigation?: { contract: number; items: unknown[] };
    pages?: Record<string, PageFixture>;
    redirects?: Record<string, { fromPath: string; toPath: string; status: number }>;
};

const crumb = (title: string, path: string) => ({ id: path, title, slug: path.split("/").pop(), path });
const pageEntry = (title: string, markdown: string) => ({
    entry: { id: title, slug: title.toLowerCase(), data: { Title: title, Blocks: [{ type: "richText", props: { markdown } }] } },
});

const TENANTS: Record<string, Tenant> = {
    baryo: {
        host: "baryo.dev",
        settings: { Name: "BaryoDev", Url: "https://baryo.dev" },
        navigation: {
            contract: 1,
            // The CMS order, which is not the order of `order`: drawn as given, never re-sorted.
            items: [
                {
                    id: "a",
                    title: "About",
                    slug: "about",
                    path: "/about",
                    order: 2,
                    children: [{ id: "t", title: "Team", slug: "team", path: "/about/team", order: null, children: [] }],
                },
                { id: "d", title: "Docs", slug: "docs", path: "/docs", order: 1, children: [] },
                { id: "b", title: "Blog page", slug: "blog", path: "/blog", order: 3, children: [] },
                { id: "x", title: "Unsafe", slug: "x", path: "javascript:alert(1)", order: 4, children: [] },
            ],
        },
        pages: {
            "/about": { ...pageEntry("About", "About us"), breadcrumbs: [crumb("About", "/about")] },
            "/about/team": {
                ...pageEntry("Team", "Meet the team"),
                breadcrumbs: [crumb("About", "/about"), crumb("Team", "/about/team")],
            },
            "/blog": pageEntry("Blog page", "A page that must never render"),
        },
        redirects: {
            "/old-about": { fromPath: "/old-about", toPath: "/about", status: 301 },
            "/moved": { fromPath: "/moved", toPath: "/about/team", status: 302 },
            "/evil": { fromPath: "/evil", toPath: "javascript:alert(1)", status: 301 },
        },
    },
    rckoronadal: {
        host: "rckoronadal.org",
        settings: { Name: "Rotary Club of Koronadal", Url: "https://rckoronadal.org" },
        navigation: { contract: 1, items: [{ id: "p", title: "Projects", slug: "projects", path: "/projects", order: 1, children: [] }] },
        pages: { "/projects": pageEntry("Projects", "Club projects") },
    },
    future: {
        host: "future.example",
        settings: { Name: "Future Club", Url: "https://future.example" },
        navigation: { contract: 2, items: [{ id: "a", title: "About", slug: "about", path: "/about", order: 1, children: [] }] },
        pages: { "/about": { ...pageEntry("About", "From a newer module"), contract: 2 } },
    },
    plain: {
        host: "plain.example",
        settings: { Name: "Plain Club", Url: "https://plain.example" },
    },
    soon: {
        host: "soon.example",
        settings: { Name: "Soon Club", Url: "https://soon.example", Mode: "Holding", HoldingPath: "/coming-soon" },
        navigation: {
            contract: 1,
            items: [
                { id: "c", title: "Opening", slug: "coming-soon", path: "/coming-soon", order: 1, children: [] },
                { id: "a", title: "About Soon", slug: "about", path: "/about", order: 2, children: [] },
            ],
        },
        pages: {
            "/coming-soon": pageEntry("Opening soon", "Opening in October"),
            "/about": pageEntry("About Soon", "The real about page"),
        },
    },
};

type Call = { path: string; tenant: string | null; tags: string[] };
let calls: Call[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push({ path: url.pathname + url.search, tenant, tags: init?.next?.tags ?? [] });

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        const list = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        const path = url.searchParams.get("path") ?? "/";
        switch (url.pathname) {
            case "/api/public/site":
                return list([{ id: "s", data: t.settings }]);
            case "/api/public/post":
                return list([]);
            case "/api/public/pages/navigation":
                return t.navigation ? Response.json(t.navigation) : new Response("", { status: 404 });
            case "/api/public/pages/resolve": {
                const page = t.pages?.[path];
                if (!page) return new Response("", { status: 404 });
                return Response.json({
                    contract: page.contract ?? 1,
                    path,
                    entry: { contentType: "page", ...page.entry },
                    breadcrumbs: page.breadcrumbs ?? [],
                });
            }
            case "/api/public/redirects/resolve": {
                const found = t.redirects?.[path];
                return found ? Response.json(found) : new Response("", { status: 404 });
            }
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });
const registry = createBlockRegistry(config);

function visit(host: string, cookie?: string) {
    requestHeaders = new Headers({ host });
    requestCookies = cookie ? { [SHARE_COOKIE]: cookie } : {};
}

async function pageHtml(cfg: Config, path: string[]): Promise<string> {
    const Page = createPage(cfg, registry);
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ path }) }));
}

/** What a page render ends in: its markup, or the message of the control flow error it threw. */
async function outcome(cfg: Config, path: string[]): Promise<string> {
    try {
        return await pageHtml(cfg, path);
    } catch (e) {
        return (e as Error).message;
    }
}

async function layoutHtml(cfg: Config = config): Promise<string> {
    const Layout = createSiteLayout(cfg, { blocks: registry, loadFonts: false });
    return renderToStaticMarkup(await Layout({ children: <p>child</p> }));
}

const resolves = (path: string) => calls.filter((c) => c.path === `/api/public/pages/resolve?path=${encodeURIComponent(path)}`);

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    requestCookies = {};
    calls = [];
    vi.stubGlobal("fetch", cms());
    vi.stubEnv("PRESS_PREVIEW_SECRET", SECRET);
    vi.stubEnv("PRESS_SECRET", undefined);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("configuring pages", () => {
    it("leaves pages off unless mounted, and keeps the mount as given with no trailing slash", () => {
        expect("pages" in defineConfig({ site: { name: "T", url: "https://t.example" } })).toBe(false);
        expect(defineConfig({ sites: {}, pages: "" }).pages).toBe("");
        expect(defineConfig({ sites: {}, pages: "/docs/" }).pages).toBe("/docs");
        expect(defineConfig({ sites: {}, pages: "docs" }).pages).toBe("/docs");
    });

    it("reserves the configured routes, the engine's own files, and any slug the site adds", () => {
        const reserved = defineConfig({ sites: {}, pages: "", reservedSlugs: [" Donate "] }).reservedSlugs;
        for (const slug of ["blog", "authors", "categories", "feed.xml", "sitemap.xml", "robots.txt", "api", "_share", "donate"]) {
            expect(reserved).toContain(slug);
        }
        const writing = defineConfig({ sites: {}, pages: "", routes: { post: "/writing", author: undefined, category: undefined } });
        expect(writing.reservedSlugs).toContain("writing");
        expect(writing.reservedSlugs).not.toContain("blog");
    });
});

describe("navigation", () => {
    it("draws each tenant its own menu, read with its own tenant header and cache tag", async () => {
        visit("baryo.dev");
        const baryo = await layoutHtml();
        visit("rckoronadal.org");
        const rotary = await layoutHtml();

        expect(baryo).toContain('data-press="navigation"');
        expect(baryo).toContain('href="/about"');
        expect(baryo).toContain('href="/about/team"');
        expect(baryo).toContain('href="/docs"');
        expect(baryo).not.toContain('href="/projects"');
        expect(rotary).toContain('href="/projects"');
        expect(rotary).not.toContain('href="/about"');

        const reads = calls.filter((c) => c.path === "/api/public/pages/navigation");
        expect(reads).toHaveLength(2);
        expect(reads.map((r) => r.tenant)).toEqual(["baryo", "rckoronadal"]);
        expect(reads.map((r) => r.tags)).toEqual([
            ["cms:baryo", "cms:baryo:type:page"],
            ["cms:rckoronadal", "cms:rckoronadal:type:page"],
        ]);
    });

    it("keeps the order and the paths the CMS gave, and drops only an item whose path is not a site path", async () => {
        visit("baryo.dev");
        const html = await layoutHtml();

        const about = html.indexOf('href="/about"');
        const docs = html.indexOf('href="/docs"');
        expect(about).toBeGreaterThan(-1);
        expect(docs).toBeGreaterThan(about);
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("Unsafe");

        const site = { ...config, tenant: "baryo" };
        const items = await getNavigation(site);
        expect(items.map((i) => i.path)).toEqual(["/about", "/docs", "/blog"]);
        expect(items[0].children.map((i) => i.path)).toEqual(["/about/team"]);
    });

    it("links under the mount when pages are not at the root", async () => {
        const mounted = defineConfig({ site: { name: "T", url: "https://t.example" }, cmsUrl: CMS, tenant: "baryo", pages: "/site" });
        const html = await layoutHtml(mounted);
        expect(html).toContain('href="/site/about"');
        expect(html).toContain('href="/site/about/team"');
        expect(html).not.toContain('href="/about"');
    });

    it("shows no menu, and still renders the site, when the navigation speaks a contract this renderer does not read", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        visit("future.example");
        const html = await layoutHtml();

        expect(html).toContain("Future Club");
        expect(html).toContain("child");
        expect(html).not.toContain('data-press="navigation"');
        expect(html).not.toContain('href="/about"');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("contract 2"));
    });

    it("shows no menu when the Pages module is not installed, or the navigation cannot be read", async () => {
        visit("plain.example");
        const plain = await layoutHtml();
        expect(plain).toContain("Plain Club");
        expect(plain).not.toContain('data-press="navigation"');

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const inner = cms();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
                String(input).includes("/pages/navigation") ? new Response("", { status: 500 }) : inner(input, init),
            ),
        );
        visit("baryo.dev");
        const broken = await layoutHtml();
        expect(broken).toContain("BaryoDev");
        expect(broken).not.toContain('data-press="navigation"');
        expect(warn).toHaveBeenCalled();
    });

    it("is never asked for by a site that mounts no pages", async () => {
        visit("baryo.dev");
        await layoutHtml(defineConfig({ sites: {}, cmsUrl: CMS }));
        expect(calls.some((c) => c.path.startsWith("/api/public/pages/"))).toBe(false);
    });
});

describe("the page route", () => {
    it("renders the page the Pages module serves at a nested path, with its blocks and breadcrumbs", async () => {
        visit("baryo.dev");
        const html = await pageHtml(config, ["about", "team"]);

        expect(html).toContain("Meet the team");
        expect(html).toContain('data-press="breadcrumbs"');
        expect(html).toContain('href="/about"');
        expect(html).toContain('<span aria-current="page">Team</span>');
        expect(resolves("/about/team")).toHaveLength(1);
        expect(resolves("/about/team")[0].tenant).toBe("baryo");
    });

    it("gives each tenant only its own pages", async () => {
        visit("baryo.dev");
        expect(await outcome(config, ["about"])).toContain("About us");
        visit("rckoronadal.org");
        expect(await outcome(config, ["about"])).toBe("NEXT_NOT_FOUND");
        expect(await outcome(config, ["projects"])).toContain("Club projects");
        visit("baryo.dev");
        expect(await outcome(config, ["projects"])).toBe("NEXT_NOT_FOUND");
    });

    it("takes its metadata from the same page", async () => {
        visit("baryo.dev");
        const meta = await createPageMetadata(config)({ params: Promise.resolve({ path: ["about", "team"] }) });
        expect(meta.title).toBe("Team");
        visit("rckoronadal.org");
        const missing = await createPageMetadata(config)({ params: Promise.resolve({ path: ["about", "team"] }) });
        expect(missing.title).toBe("Not found");
    });

    it("asks the redirects map on a miss, and follows only a safe destination", async () => {
        visit("baryo.dev");
        expect(await outcome(config, ["old-about"])).toBe("NEXT_REDIRECT 308 /about");
        expect(await outcome(config, ["moved"])).toBe("NEXT_REDIRECT 307 /about/team");
        expect(await outcome(config, ["evil"])).toBe("NEXT_NOT_FOUND");
        expect(await outcome(config, ["nope"])).toBe("NEXT_NOT_FOUND");
        const asked = calls.filter((c) => c.path.startsWith("/api/public/redirects/resolve")).map((c) => c.path);
        expect(asked).toEqual([
            "/api/public/redirects/resolve?path=%2Fold-about",
            "/api/public/redirects/resolve?path=%2Fmoved",
            "/api/public/redirects/resolve?path=%2Fevil",
            "/api/public/redirects/resolve?path=%2Fnope",
        ]);
        // A page that resolves never asks.
        calls = [];
        await pageHtml(config, ["about"]);
        expect(calls.some((c) => c.path.startsWith("/api/public/redirects/"))).toBe(false);
    });

    it("renders no page under a reserved slug at the root, without asking for it", async () => {
        visit("baryo.dev");
        for (const path of [["blog", "a", "b"], ["Blog", "x", "y"], ["feed.xml"], ["api", "anything"]]) {
            expect(await outcome(config, path)).toBe("NEXT_NOT_FOUND");
        }
        expect(calls.some((c) => c.path.startsWith("/api/public/pages/resolve"))).toBe(false);
        expect(isReservedPath(config, "/blog")).toBe(true);
        expect(isReservedPath(config, "/blogger")).toBe(false);

        // The post collection's own route answers its index through the catch-all, never a page there.
        expect(await outcome(config, ["blog"])).toContain('class="masthead"');
        expect(resolves("/blog")).toHaveLength(0);
    });

    it("resolves a reserved slug under a mount, where it shadows nothing", async () => {
        const mounted = defineConfig({ site: { name: "T", url: "https://t.example" }, cmsUrl: CMS, tenant: "baryo", pages: "/site" });
        expect(isReservedPath(mounted, "/blog")).toBe(false);
        expect(await outcome(mounted, ["blog"])).toContain("A page that must never render");
    });

    it("reads by slug when mounted on a slug route, as before", async () => {
        visit("baryo.dev");
        const Page = createPage(config, registry);
        await expect(Page({ params: Promise.resolve({ slug: "about" }) })).rejects.toThrow("NEXT_NOT_FOUND");
        expect(calls.some((c) => c.path === "/api/public/page/about")).toBe(true);
        expect(calls.some((c) => c.path.startsWith("/api/public/pages/resolve"))).toBe(false);
        expect(calls.some((c) => c.path.startsWith("/api/public/redirects/"))).toBe(false);
    });
});

describe("holding mode", () => {
    it("still wins over pages: no page is read and no menu is drawn for a visitor without a session", async () => {
        visit("soon.example");
        expect(await outcome(config, ["about"])).toBe("NEXT_NOT_FOUND");
        expect(resolves("/about")).toHaveLength(0);

        const html = await layoutHtml();
        expect(html).toContain('data-press="holding"');
        expect(html).toContain("Opening in October");
        expect(html).not.toContain('data-press="navigation"');
        expect(html).not.toContain("About Soon");
        await expect(createSitemap(config)()).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("shows a visitor with a session the pages and the menu, without the holding page in it", async () => {
        const cookie = signShareCookie("soon", Math.floor(Date.now() / 1000) + 3600, SECRET);
        visit("soon.example", cookie);
        expect(await outcome(config, ["about"])).toContain("The real about page");

        const html = await layoutHtml();
        expect(html).toContain('data-press="navigation"');
        expect(html).toContain('href="/about"');
        expect(html).not.toContain('href="/coming-soon"');
    });
});

describe("pages in the sitemap and static params", () => {
    it("lists each tenant's menu pages, less those under a reserved slug", async () => {
        visit("baryo.dev");
        const baryo = (await createSitemap(config)()).map((e) => e.url);
        expect(baryo).toEqual(["https://baryo.dev", "https://baryo.dev/about", "https://baryo.dev/about/team", "https://baryo.dev/docs"]);

        visit("rckoronadal.org");
        const rotary = (await createSitemap(config)()).map((e) => e.url);
        expect(rotary).toEqual(["https://rckoronadal.org", "https://rckoronadal.org/projects"]);
    });

    it("lists the menu's paths as catch-all segments on a build-time site, and nothing on a request-time one", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const buildTime = defineConfig({ site: { name: "T", url: "https://t.example" }, cmsUrl: CMS, tenant: "baryo", pages: "" });
        expect(await createPageStaticParams(buildTime)()).toEqual([
            { path: ["about"] },
            { path: ["about", "team"] },
            { path: ["docs"] },
        ]);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("/blog"));
        expect(await createPageStaticParams(config)()).toEqual([]);
    });
});
