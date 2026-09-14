import { createHash } from "node:crypto";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The request and its cookies are whatever the test says. Either one throwing when unset is the
 * assertion that it was not read.
 */
let requestHeaders: Headers | null = null;
let requestCookies: Record<string, string> | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => {
        if (!requestCookies) throw new Error("cookies() was read");
        const jar = requestCookies;
        return { get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined) };
    },
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
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
const { applySiteSettings, previewKeyMatches, siteConfig, PREVIEW_COOKIE } = await import("./site.js");
const { createBlogIndex } = await import("./screens/blog-index.js");
const { createSiteLayout, createSiteMetadata } = await import("./screens/site-layout.js");
const { createFeed } = await import("./routes/feed.js");
const { createSitemap } = await import("./routes/sitemap.js");
const { createRobots } = await import("./routes/robots.js");
const { createPreviewKeyRoute } = await import("./routes/preview-key.js");
const { createBlockRegistry } = await import("./blocks/registry.js");

const CMS = "http://cms.test";
const KEY = "preview-key-for-tests-0123";
const HASH = createHash("sha256").update(KEY).digest("hex");

const TENANTS: Record<string, { host: string; settings: Record<string, unknown>; post: string }> = {
    soon: {
        host: "soon.example",
        settings: {
            Name: "Soon Club",
            Url: "https://soon.example",
            ComingSoon: true,
            ComingSoonBlocks: [{ type: "richText", props: { markdown: "## Opening in October" } }],
            PreviewKeyHash: HASH,
        },
        post: "launch-plans",
    },
    baryo: {
        host: "baryo.dev",
        settings: { Name: "BaryoDev", Url: "https://baryo.dev" },
        post: "shipping-notes",
    },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const handle = new Headers(init?.headers).get("x-tenant");
        const t = handle ? TENANTS[handle] : undefined;
        if (!t) return new Response("", { status: 404 });
        const page = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") return page([{ id: "s", data: t.settings }]);
        if (url.pathname === "/api/public/post")
            return page([{ id: t.post, slug: t.post, data: { Title: `${t.settings.Name} post`, Slug: t.post, Body: "x" } }]);
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });
const registry = createBlockRegistry(config);

/** A visitor: the host they asked for, and the preview cookie if they have one. */
function visit(host: string, cookie?: string) {
    requestHeaders = new Headers({ host });
    requestCookies = cookie === undefined ? {} : { [PREVIEW_COOKIE]: cookie };
}

async function layoutHtml(): Promise<string> {
    const Layout = createSiteLayout(config, { blocks: registry, loadFonts: false });
    const Index = createBlogIndex(config);
    // As Next does it: the page renders first, and a 404 from it leaves the layout nothing but a fallback.
    let children: ReactNode;
    try {
        children = await Index();
    } catch (e) {
        if ((e as Error).message !== "NEXT_NOT_FOUND") throw e;
        children = <p>not found fallback</p>;
    }
    return renderToStaticMarkup(await Layout({ children }));
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    requestCookies = null;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("reading coming soon from the site settings", () => {
    const base = { ...config, tenant: "t" };

    it("is off when the settings leave the fields out, which is every tenant today", () => {
        expect(applySiteSettings(base, { Name: "X" }, null).comingSoon).toBeUndefined();
        expect(applySiteSettings(base, undefined, null).comingSoon).toBeUndefined();
        expect(applySiteSettings(base, { ComingSoon: false, PreviewKeyHash: HASH }, null).comingSoon).toBeUndefined();
    });

    it("reads the flag, the blocks and the hash, the flag as a boolean or as text", () => {
        const on = applySiteSettings(base, { ComingSoon: "true", ComingSoonBlocks: "[]", PreviewKeyHash: HASH.toUpperCase() }, null);
        expect(on.comingSoon).toEqual({ blocks: [], previewKeyHash: HASH });
    });

    it("keeps the mode on with no working key when the hash is unreadable, so nobody gets through", () => {
        const on = applySiteSettings(base, { ComingSoon: true, PreviewKeyHash: KEY }, null);
        expect(on.comingSoon).toEqual({ blocks: undefined, previewKeyHash: undefined });
        expect(previewKeyMatches(on.comingSoon!, KEY)).toBe(false);
    });

    it("accepts only the key whose hash the settings hold", () => {
        const soon = { previewKeyHash: HASH };
        expect(previewKeyMatches(soon, KEY)).toBe(true);
        expect(previewKeyMatches(soon, `${KEY}x`)).toBe(false);
        expect(previewKeyMatches(soon, HASH)).toBe(false);
        expect(previewKeyMatches(soon, "")).toBe(false);
        expect(previewKeyMatches(soon, null)).toBe(false);
        // Short keys never match, so a key an offline guess could find from the public hash is useless.
        const short = "short-key";
        expect(previewKeyMatches({ previewKeyHash: createHash("sha256").update(short).digest("hex") }, short)).toBe(false);
    });
});

describe("a tenant with coming soon on", () => {
    it("holds back every page from a new visitor, and shows it to one with the key", async () => {
        visit("soon.example");
        await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");

        visit("soon.example", "wrong-key-but-long-enough-000");
        await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");

        visit("soon.example", KEY);
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "soon" });
    });

    it("renders the holding page from its blocks, with none of the site in it", async () => {
        visit("soon.example");
        const html = await layoutHtml();

        expect(html).toContain('data-press="coming-soon"');
        expect(html).toContain("Opening in October");
        expect(html).not.toContain("launch-plans");
        expect(html).not.toContain("Soon Club post");
        expect(html).not.toContain("not found fallback");
        expect(html).not.toContain("/feed.xml");
    });

    it("renders the default holding page from the theme when there are no blocks", async () => {
        const saved = TENANTS.soon.settings.ComingSoonBlocks;
        TENANTS.soon.settings.ComingSoonBlocks = [{ type: "notRegistered", props: {} }];
        try {
            visit("soon.example");
            const html = await layoutHtml();
            expect(html).toContain("Soon Club");
            expect(html).toContain("Coming soon.");
            expect(html).not.toContain("launch-plans");
        } finally {
            TENANTS.soon.settings.ComingSoonBlocks = saved;
        }
    });

    it("never hands a visitor without the key the render made for one with it, or the reverse", async () => {
        const seen: string[] = [];
        for (const cookie of [KEY, undefined, KEY, undefined, "wrong-key-but-long-enough-000", KEY]) {
            visit("soon.example", cookie);
            const html = await layoutHtml();
            const held = html.includes('data-press="coming-soon"');
            const real = html.includes("launch-plans");
            expect(held).not.toBe(real);
            seen.push(held ? "held" : "real");
        }
        expect(seen).toEqual(["real", "held", "real", "held", "held", "real"]);
    });

    it("marks the site noindex and drops the feed link, key or not", async () => {
        for (const cookie of [undefined, KEY]) {
            visit("soon.example", cookie);
            const meta = await createSiteMetadata(config)();
            expect(meta.robots).toEqual({ index: false, follow: false });
            expect(meta.alternates).toBeUndefined();
        }
    });

    it("serves no feed or sitemap, key or not, and a robots that disallows everything", async () => {
        for (const cookie of [undefined, KEY]) {
            visit("soon.example", cookie);
            expect((await createFeed(config)()).status).toBe(404);
            await expect(createSitemap(config)()).rejects.toThrow("NEXT_NOT_FOUND");
            const robots = await createRobots(config)();
            expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
            expect(robots.sitemap).toBeUndefined();
        }
    });
});

describe("another tenant on the same container", () => {
    it("is unaffected, and its requests never read the cookie", async () => {
        // Warm the coming soon tenant first, in the same process, so anything shared would show.
        visit("soon.example");
        await layoutHtml();

        requestHeaders = new Headers({ host: "baryo.dev" });
        requestCookies = null;
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "baryo" });
        const html = await layoutHtml();
        expect(html).toContain("shipping-notes");
        expect(html).not.toContain('data-press="coming-soon"');
        expect(html).toContain("/feed.xml");

        const feed = await createFeed(config)();
        expect(feed.status).toBe(200);
        expect(await feed.text()).toContain("https://baryo.dev/blog/shipping-notes");
        expect((await createRobots(config)()).sitemap).toBe("https://baryo.dev/sitemap.xml");
        expect((await createSiteMetadata(config)()).robots).toBeUndefined();
    });
});

describe("the preview key route", () => {
    const GET = createPreviewKeyRoute(config);
    const ask = (host: string, query: string) =>
        GET(new Request(`http://internal:3000/api/coming-soon?${query}`, { headers: { host } }));

    it("sets a host-only HttpOnly, Secure, SameSite=Lax cookie for the right key and redirects the key away", async () => {
        const res = await ask("soon.example", `key=${KEY}&to=/blog/launch-plans`);

        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/blog/launch-plans");
        expect(res.headers.get("cache-control")).toBe("no-store");
        const cookie = res.headers.get("set-cookie") ?? "";
        expect(cookie.startsWith(`${PREVIEW_COOKIE}=${KEY};`)).toBe(true);
        for (const part of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(cookie).toContain(`; ${part}`);
        expect(cookie.toLowerCase()).not.toContain("domain=");
    });

    it("gives a wrong key the same redirect and no cookie", async () => {
        for (const key of ["wrong-key-but-long-enough-000", HASH, "", "short"]) {
            const res = await ask("soon.example", `key=${encodeURIComponent(key)}&to=/blog/launch-plans`);
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/blog/launch-plans");
            expect(res.headers.get("set-cookie")).toBeNull();
        }
    });

    it("gives the key to no other tenant", async () => {
        const res = await ask("baryo.dev", `key=${KEY}`);
        expect(res.status).toBe(303);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect((await ask("unknown.example", `key=${KEY}`)).status).toBe(404);
    });

    it("redirects only to a path on this site", async () => {
        for (const to of ["//evil.example", "/\\evil.example", "https://evil.example/", "evil", "/a b"]) {
            const res = await ask("soon.example", `key=${KEY}&to=${encodeURIComponent(to)}`);
            expect(res.headers.get("location")).toBe("/");
        }
    });

    it("never logs the key", async () => {
        const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
            vi.spyOn(console, m).mockImplementation(() => {}),
        );
        await ask("soon.example", `key=${KEY}`);
        await ask("soon.example", "key=wrong-key-but-long-enough-000");
        visit("soon.example", KEY);
        await layoutHtml();
        for (const spy of spies) {
            for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(KEY);
        }
    });
});
