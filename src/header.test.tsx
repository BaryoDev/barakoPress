import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The header as settings (#127): `activeOn`, nested links, `MenuLinks` and `HeaderActions`.
 *
 * The compatibility case lives in regions.test.tsx and stays as it is. The last describe here adds
 * the other half: a tenant that sets `HeaderLinks` and nothing new gets none of the new markup.
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
const { isCurrentPath, isCurrentLink } = await import("./current-path.js");
const { dropdownNext } = await import("./screens/header-menu.js");

const CMS = "http://cms.test";

const PRODUCTS = {
    label: "Products",
    href: "/products",
    children: [
        { label: "Engine", href: "/products/engine", activeOn: "/products/engine" },
        { label: "Console", href: "https://console.example", activeOn: "/console", external: true },
    ],
};

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    press: {
        host: "press.example",
        settings: {
            Name: "Press",
            Url: "https://press.example",
            HeaderLinks: [
                { label: "Home", href: "/", activeOn: "/" },
                { label: "Docs", href: "/docs/", activeOn: "/docs /guides" },
                { label: "Chat", href: "https://chat.example/invite", activeOn: "/community", external: true },
                PRODUCTS,
            ],
            MenuLinks: JSON.stringify([
                { label: "Start here", href: "/start", activeOn: "/start" },
                { label: "Docs", href: "/docs/", activeOn: "/docs", badge: "NEW" },
                PRODUCTS,
            ]),
            HeaderActions: [
                { label: "Sign in", href: "https://console.example/login", variant: "plain" },
                { label: "Get started", href: "/start", variant: "primary" },
            ],
        },
    },
    // Only activeOn set: the phone menu falls back to HeaderLinks.
    marked: {
        host: "marked.example",
        settings: {
            Name: "Marked",
            Url: "https://marked.example",
            HeaderLinks: [
                { label: "Blog", href: "/blog", activeOn: "/blog" },
                { label: "About", href: "/about" },
            ],
        },
    },
    // HeaderLinks and nothing new.
    plain: {
        host: "plain.example",
        settings: {
            Name: "Plain",
            Url: "https://plain.example",
            HeaderLinks: [{ label: "Blog", href: "/blog", badge: "V1" }, { label: "About", href: "/about" }],
        },
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
        if (url.pathname === "/api/public/post") {
            return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNextPage: false });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });
const base = { ...config, tenant: "t" };

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

/** Every opening tag in `html` that carries `attr`. */
function tagsWith(html: string, attr: string): string[] {
    return [...html.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(attr));
}

/** The desktop row, which is everything before the phone menu. */
function desktop(header: string): string {
    return header.slice(0, header.indexOf('data-press="menu"'));
}

/** The phone menu. */
function phone(header: string): string {
    return header.slice(header.indexOf('data-press="menu"'));
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

describe("activeOn", () => {
    it("treats / as the home page alone", () => {
        expect(isCurrentPath("/", "/")).toBe(true);
        expect(isCurrentPath("/docs", "/")).toBe(false);
        expect(isCurrentPath("/docs/intro", "/")).toBe(false);
    });

    it("matches a path and everything below it, and nothing that only shares a prefix", () => {
        expect(isCurrentPath("/docs", "/docs")).toBe(true);
        expect(isCurrentPath("/docs/intro/setup", "/docs")).toBe(true);
        expect(isCurrentPath("/docsite", "/docs")).toBe(false);
        expect(isCurrentPath("/", "/docs")).toBe(false);
    });

    it("ignores a trailing slash on either side", () => {
        expect(isCurrentPath("/docs/", "/docs")).toBe(true);
        expect(isCurrentPath("/docs", "/docs/")).toBe(true);
        expect(isCurrentPath("/docs/intro/", "/docs/")).toBe(true);
    });

    it("drops the rewrite prefix before comparing", () => {
        expect(isCurrentPath("/_press/press~public~press.example/docs/intro", "/docs")).toBe(true);
        expect(isCurrentPath("/_press/press~public~press.example", "/")).toBe(true);
        expect(isCurrentPath("/_press/press~public~press.example/", "/")).toBe(true);
        expect(isCurrentPath("/_press/press~public~press.example/blog", "/")).toBe(false);
        // Only a leading prefix is the rewrite's.
        expect(isCurrentPath("/docs/_press/x", "/docs/_press/x")).toBe(true);
        expect(isCurrentPath("/_pressroom/docs", "/docs")).toBe(false);
    });

    it("reads a space separated list, any one of which matches", () => {
        expect(isCurrentPath("/guides/a", "/docs  /guides")).toBe(true);
        expect(isCurrentPath("/blog", "/docs /guides")).toBe(false);
    });

    it("is never current without a path or a list", () => {
        expect(isCurrentPath(null, "/")).toBe(false);
        expect(isCurrentPath("/", undefined)).toBe(false);
        expect(isCurrentPath("/", "   ")).toBe(false);
    });

    it("marks a parent current when one of its children matches", () => {
        expect(isCurrentLink("/products/engine/v2", PRODUCTS)).toBe(true);
        expect(isCurrentLink("/console", PRODUCTS)).toBe(true);
        expect(isCurrentLink("/products", PRODUCTS)).toBe(false);
    });
});

describe("reading the header settings", () => {
    it("keeps activeOn as the paths it could read, and drops one with none", () => {
        const links = applySiteSettings(
            base,
            {
                HeaderLinks: [
                    { label: "A", href: "/a", activeOn: " /a   /b/ " },
                    { label: "B", href: "/b", activeOn: "/ok //evil.example javascript:x /a?b /c<d" },
                    { label: "C", href: "/c", activeOn: "nothing usable" },
                    { label: "D", href: "/d", activeOn: 5 },
                ],
            },
            null,
        ).site.headerLinks;
        expect(links).toHaveLength(4);
        expect(links?.map((l) => l.activeOn)).toEqual(["/a /b/", "/ok", undefined, undefined]);
        expect(links?.[2]).not.toHaveProperty("activeOn");
    });

    it("reads children one level deep, sanitised like their parent", () => {
        const links = applySiteSettings(
            base,
            {
                HeaderLinks: [
                    {
                        label: "Products",
                        href: "/products",
                        children: [
                            { label: "Engine", href: "/products/engine", activeOn: "/products/engine", badge: "V2" },
                            { label: "Bad", href: "javascript:alert(1)" },
                            { label: "Deep", href: "/deep", children: [{ label: "Deeper", href: "/deeper" }] },
                        ],
                    },
                    { label: "Empty", href: "/empty", children: [] },
                    { label: "Wrong", href: "/wrong", children: "not a list" },
                ],
            },
            null,
        ).site.headerLinks;

        expect(links).toHaveLength(3);
        const children = links?.[0].children ?? [];
        expect(children).toHaveLength(2);
        expect(children).toEqual([
            { label: "Engine", href: "/products/engine", activeOn: "/products/engine", badge: "V2" },
            { label: "Deep", href: "/deep" },
        ]);
        expect(links?.[1]).not.toHaveProperty("children");
        expect(links?.[2]).not.toHaveProperty("children");
    });

    it("reads children saved as JSON text", () => {
        const links = applySiteSettings(
            base,
            { HeaderLinks: JSON.stringify([{ ...PRODUCTS, children: JSON.stringify(PRODUCTS.children) }]) },
            null,
        ).site.headerLinks;
        expect(links).toHaveLength(1);
        expect(links?.[0].children).toHaveLength(2);
    });

    it("does not read children in the footer or the top bar", () => {
        const site = applySiteSettings(
            base,
            {
                FooterColumns: [{ heading: "More", links: [PRODUCTS] }],
                TopBar: { links: [PRODUCTS] },
            },
            null,
        ).site;
        expect(site.footerColumns?.[0].links).toHaveLength(1);
        expect(site.footerColumns?.[0].links[0]).not.toHaveProperty("children");
        expect(site.topBar?.links).toHaveLength(1);
        expect(site.topBar?.links[0]).not.toHaveProperty("children");
    });

    it("reads MenuLinks like HeaderLinks, as a list or as JSON text", () => {
        const rows = [
            { label: "Start", href: "/start", activeOn: "/start", badge: "NEW", external: false },
            { label: "Chat", href: "https://chat.example", external: true },
            PRODUCTS,
        ];
        for (const value of [rows, JSON.stringify(rows)]) {
            const menu = applySiteSettings(base, { MenuLinks: value }, null).site.menuLinks;
            expect(menu).toHaveLength(3);
            expect(menu?.[0]).toEqual({ label: "Start", href: "/start", activeOn: "/start", badge: "NEW" });
            expect(menu?.[1]).toEqual({ label: "Chat", href: "https://chat.example", external: true });
            expect(menu?.[2].children).toHaveLength(2);
        }
    });

    it("drops MenuLinks rows of the wrong shape and keeps the rest", () => {
        const menu = applySiteSettings(
            base,
            {
                MenuLinks: [
                    { label: "Kept", href: "/kept" },
                    { label: "No href" },
                    { href: "/no-label" },
                    { label: "Script", href: "javascript:alert(1)" },
                    { label: "Protocol relative", href: "//evil.example" },
                    "a string",
                    5,
                    null,
                ],
            },
            null,
        ).site.menuLinks;
        expect(menu).toEqual([{ label: "Kept", href: "/kept" }]);
    });

    it("keeps the configured MenuLinks when the setting is not a list, and clears them when it is empty", () => {
        const configured = { ...base, site: { ...base.site, menuLinks: [{ label: "Built in", href: "/b" }] } };
        expect(applySiteSettings(configured, { MenuLinks: "not json" }, null).site.menuLinks).toEqual([
            { label: "Built in", href: "/b" },
        ]);
        expect(applySiteSettings(configured, { MenuLinks: { label: "x", href: "/x" } }, null).site.menuLinks).toEqual([
            { label: "Built in", href: "/b" },
        ]);
        expect(applySiteSettings(configured, { MenuLinks: [] }, null).site.menuLinks).toEqual([]);
        expect(applySiteSettings(base, {}, null).site.menuLinks).toBeUndefined();
    });

    it("reads HeaderActions with a variant, as a list or as JSON text", () => {
        const actions = [
            { label: "Get started", href: "/start", variant: "primary", badge: "FREE" },
            { label: "Docs", href: "/docs", variant: "Secondary" },
            { label: "Sign in", href: "https://console.example/login", variant: "plain", external: true },
        ];
        for (const value of [actions, JSON.stringify(actions)]) {
            expect(applySiteSettings(base, { HeaderActions: value }, null).site.headerActions).toEqual([
                { label: "Get started", href: "/start", variant: "primary", badge: "FREE" },
                { label: "Docs", href: "/docs", variant: "secondary" },
                { label: "Sign in", href: "https://console.example/login", variant: "plain", external: true },
            ]);
        }
    });

    it("gives an action with no variant, or one it does not know, the primary one", () => {
        const actions = applySiteSettings(
            base,
            {
                HeaderActions: [
                    { label: "A", href: "/a" },
                    { label: "B", href: "/b", variant: "loud" },
                    { label: "C", href: "/c", variant: 5 },
                ],
            },
            null,
        ).site.headerActions;
        expect(actions).toHaveLength(3);
        expect(actions?.map((a) => a.variant)).toEqual(["primary", "primary", "primary"]);
    });

    it("drops actions of the wrong shape, and never reads activeOn or children on one", () => {
        const actions = applySiteSettings(
            base,
            {
                HeaderActions: [
                    { label: "Kept", href: "/kept", activeOn: "/kept", children: [{ label: "x", href: "/x" }] },
                    { label: "No href", variant: "primary" },
                    { label: "Script", href: "javascript:alert(1)" },
                    [],
                ],
            },
            null,
        ).site.headerActions;
        expect(actions).toEqual([{ label: "Kept", href: "/kept", variant: "primary" }]);
    });

    it("keeps at most four actions", () => {
        const many = Array.from({ length: 6 }, (_, i) => ({ label: `A${i}`, href: `/a${i}` }));
        expect(applySiteSettings(base, { HeaderActions: many }, null).site.headerActions).toHaveLength(4);
    });

    it("leaves a link to the holding page out of MenuLinks, HeaderActions and children while holding", () => {
        const site = applySiteSettings(
            base,
            {
                Url: "https://press.example",
                Mode: "Holding",
                HoldingPath: "/soon",
                HeaderLinks: [{ label: "P", href: "/p", children: [{ label: "Soon", href: "/soon" }, { label: "Q", href: "/q" }] }],
                MenuLinks: [{ label: "Soon", href: "/soon" }, { label: "R", href: "/r" }],
                HeaderActions: [{ label: "Soon", href: "https://press.example/soon/" }, { label: "S", href: "/s" }],
            },
            null,
        ).site;
        expect(site.headerLinks?.[0].children).toEqual([{ label: "Q", href: "/q" }]);
        expect(site.menuLinks).toEqual([{ label: "R", href: "/r" }]);
        expect(site.headerActions).toEqual([{ label: "S", href: "/s", variant: "primary" }]);
    });
});

describe("the built-in header with the new settings", () => {
    it("marks the link whose activeOn matches, with aria-current and a class", async () => {
        const header = desktop(await headerAt("press.example", "/guides/setup"));
        const current = tagsWith(header, 'aria-current="page"');
        expect(current).toHaveLength(1);
        expect(current[0]).toContain('href="/docs/"');
        expect(current[0]).toContain("bp-current");
    });

    it("marks a link current on a path it does not point to", async () => {
        const header = desktop(await headerAt("press.example", "/community/events"));
        const current = tagsWith(header, 'aria-current="page"');
        expect(current).toHaveLength(1);
        expect(current[0]).toContain('href="https://chat.example/invite"');
    });

    it("marks home on the home page alone, through the rewrite prefix", async () => {
        const home = tagsWith(desktop(await headerAt("press.example", "/_press/press~public~press.example")), 'aria-current="page"');
        expect(home).toHaveLength(1);
        expect(home[0]).toContain('href="/"');
        expect(tagsWith(desktop(await headerAt("press.example", "/blog")), 'aria-current="page"')).toEqual([]);
    });

    it("marks a parent current when a child's activeOn matches, and the child too", async () => {
        const current = tagsWith(desktop(await headerAt("press.example", "/products/engine")), 'aria-current="page"');
        expect(current).toHaveLength(2);
        expect(current[0]).toContain('href="/products"');
        expect(current[1]).toContain('href="/products/engine"');
    });

    it("draws children as a dropdown with a button that controls the list", async () => {
        const header = desktop(await headerAt("press.example", "/"));
        const buttons = tagsWith(header, "aria-expanded");
        expect(buttons).toHaveLength(1);
        const button = buttons[0];
        expect(button).toMatch(/^<button\b/);
        expect(button).toContain('type="button"');
        expect(button).toContain('aria-expanded="false"');
        expect(button).toContain('aria-label="Products links"');
        const controls = button.match(/aria-controls="([^"]+)"/)?.[1];
        expect(controls).toBeTruthy();
        const list = tagsWith(header, `id="${controls}"`);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatch(/^<ul\b/);
        // Every child is a link in the markup, so nothing needs a script to reach it.
        const after = header.slice(header.indexOf(list[0]));
        expect(after).toContain('href="/products/engine"');
        expect(after).toContain('href="https://console.example"');
        expect(header).not.toContain('role="tablist"');
        expect(header).not.toContain('role="menu"');
    });

    it("draws the actions with their variants after the links", async () => {
        const header = desktop(await headerAt("press.example", "/"));
        const actions = tagsWith(header, "data-variant=");
        expect(actions).toHaveLength(2);
        expect(actions[0]).toContain('href="https://console.example/login"');
        expect(actions[0]).toContain('data-variant="plain"');
        expect(actions[1]).toContain('href="/start"');
        expect(actions[1]).toContain('data-variant="primary"');
        // The primary one is filled with the accent, from the theme rather than a colour of its own.
        expect(actions[1]).toContain(`background:${config.theme.colors.accent}`);
    });

    it("draws a phone menu from MenuLinks, with children indented and the actions under the rows", async () => {
        const header = await headerAt("press.example", "/docs/intro");
        const menu = phone(header);
        expect(menu.length).toBeGreaterThan(0);
        expect(menu).toMatch(/^data-press="menu"/);
        expect(header).toMatch(/<details class="bp-menu" data-press="menu"/);
        expect(menu).toMatch(/<summary[^>]*aria-label="Open menu"/);
        expect(menu).toContain('aria-label="Menu"');

        const rows = tagsWith(menu, 'data-press="menu-link"');
        expect(rows.map((r) => r.match(/href="([^"]+)"/)?.[1])).toEqual([
            "/start",
            "/docs/",
            "/products",
            "/products/engine",
            "https://console.example",
        ]);
        expect(menu).toContain(">NEW<");
        // Rows from MenuLinks, not HeaderLinks.
        expect(menu).not.toContain('href="https://chat.example/invite"');

        const current = tagsWith(menu, 'aria-current="page"');
        expect(current).toHaveLength(1);
        expect(current[0]).toContain('href="/docs/"');

        const nested = menu.match(/<ul[^>]*data-press="menu-children"[^>]*>/g) ?? [];
        expect(nested).toHaveLength(1);
        expect(nested[0]).toContain("padding-left");

        const actions = tagsWith(menu, "data-variant=");
        expect(actions).toHaveLength(2);
    });

    it("falls back to HeaderLinks for the phone menu", async () => {
        const menu = phone(await headerAt("marked.example", "/blog/post"));
        const rows = tagsWith(menu, 'data-press="menu-link"');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain('href="/blog"');
        expect(rows[0]).toContain('aria-current="page"');
        expect(rows[1]).toContain('href="/about"');
    });

    it("keeps the desktop row's markup when only activeOn is set", async () => {
        const header = desktop(await headerAt("marked.example", "/elsewhere"));
        expect(header).toContain('<a href="/about" style="color:inherit;text-decoration:none">About</a>');
        expect(header).toContain('<a href="/blog" style="color:inherit;text-decoration:none">Blog</a>');
        expect(tagsWith(header, "data-variant=")).toEqual([]);
        expect(tagsWith(header, "aria-expanded")).toEqual([]);
    });

    it("hides the desktop links and shows the phone menu below the breakpoint, from a stylesheet", async () => {
        const header = await headerAt("press.example", "/");
        const css = header.match(/<style>([^<]*)<\/style>/)?.[1] ?? "";
        expect(css.length).toBeGreaterThan(0);
        expect(css).toContain(".bp-menu{display:none}");
        expect(css).toMatch(/@media\(max-width:[^)]+\)\{[^}]*\.bp-header-links/);
    });

    it("takes the menu words from the tenant's labels", async () => {
        TENANTS.press.settings.Labels = { openMenu: "Buksan ang menu", menu: "Mga link", submenu: "Mga {label}" };
        try {
            const header = await headerAt("press.example", "/");
            expect(header).toContain('aria-label="Buksan ang menu"');
            expect(header).toContain('aria-label="Mga link"');
            expect(header).toContain('aria-label="Mga Products"');
        } finally {
            delete TENANTS.press.settings.Labels;
        }
    });
});

describe("a tenant that sets none of the new settings", () => {
    it("gets none of the new markup", async () => {
        const header = await headerAt("plain.example", "/blog");
        expect(header).toContain('href="/blog"');
        for (const hook of ["bp-", "aria-current", "aria-expanded", "<details", "<style", "data-variant", 'data-press="menu"']) {
            expect(header).not.toContain(hook);
        }
    });
});

describe("the dropdown's state", () => {
    it("opens on hover and on focus, and toggles from its button", () => {
        expect(dropdownNext(false, { type: "enter" })).toBe(true);
        expect(dropdownNext(false, { type: "focus" })).toBe(true);
        expect(dropdownNext(false, { type: "toggle" })).toBe(true);
        expect(dropdownNext(true, { type: "toggle" })).toBe(false);
    });

    it("closes on Escape", () => {
        expect(dropdownNext(true, { type: "escape" })).toBe(false);
    });

    it("closes when focus leaves it, and not when focus moves inside it", () => {
        expect(dropdownNext(true, { type: "blur", inside: false })).toBe(false);
        expect(dropdownNext(true, { type: "blur", inside: true })).toBe(true);
    });

    it("closes when the pointer leaves, unless focus is still inside", () => {
        expect(dropdownNext(true, { type: "leave", inside: false })).toBe(false);
        expect(dropdownNext(true, { type: "leave", inside: true })).toBe(true);
    });
});
