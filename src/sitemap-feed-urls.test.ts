import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The sitemap lists every published page and writes each URL as the site serves it (#168), and the
 * feed's link and guid are that same URL (#170). The site here draws its header from HeaderLinks and
 * has no page in a menu, which is the shape that used to leave the sitemap without a page.
 */

vi.mock("next/headers", () => ({
    headers: async () => new Headers({ host: "studio.example" }),
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw new Error("NEXT_NOT_FOUND");
    },
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { createSitemap, forgetSitemapWarnings, SITEMAP_MAX_URLS } = await import("./routes/sitemap.js");
const { createFeed } = await import("./routes/feed.js");

const CMS = "http://cms.test";
const ORIGIN = "https://studio.example";

const SETTINGS = {
    Name: "Studio",
    Url: ORIGIN,
    FooterPath: "/footer",
    HeaderLinks: [
        { label: "About", href: "/about" },
        { label: "Work", href: "/work", children: [{ label: "Clients", href: "/clients?x=1#top" }] },
        { label: "Console", href: "https://console.example", external: true },
        { label: "Feed", href: "/feed.xml" },
        { label: "Q and A", href: "/q&a" },
    ],
};

const PAGES = [
    { id: "1", slug: "about", data: { Title: "About" } },
    { id: "2", slug: "pricing", data: { Title: "Pricing" } },
    { id: "3", slug: "secret", data: { Title: "Secret" }, seo: { noIndex: true } },
    { id: "4", slug: "footer", data: { Title: "Footer" } },
    { id: "5", slug: "team", data: { Title: "Team (nested, not served at its slug)" } },
];

let bulk = 0;
const bulkPage = (n: number) => ({ id: `b${n}`, slug: `p${n}`, data: { Title: `P${n}` } });

const POSTS = [{ id: "p", slug: "hello", data: { Title: "Hello" } }];

function cms() {
    return vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const list = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 100, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname.startsWith("/api/tenants/by-host/")) return Response.json({ handle: "studio" });
        if (url.pathname === "/api/public/site") return list([{ id: "s", data: SETTINGS }]);
        if (url.pathname === "/api/public/page" && bulk > 0) {
            const page = Number(url.searchParams.get("page") ?? "1");
            const items = Array.from({ length: 1000 }, (_, i) => bulkPage((page - 1) * 1000 + i)).filter((p) => Number(p.id.slice(1)) < bulk);
            return Response.json({ items, page, pageSize: 1000, totalItems: bulk, totalPages: Math.ceil(bulk / 1000), hasNextPage: page * 1000 < bulk });
        }
        if (url.pathname === "/api/public/page") return list(PAGES);
        if (url.pathname === "/api/public/pages/resolve" && bulk > 0) {
            const path = url.searchParams.get("path") ?? "/";
            return Response.json({ contract: 2, path, entry: { contentType: "page", id: path, slug: path.slice(1), data: {} }, breadcrumbs: [] });
        }
        if (url.pathname === "/api/public/post") return list(POSTS);
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "/";
            const found = PAGES.find((p) => `/${p.slug}` === path && p.slug !== "team");
            return found
                ? Response.json({ contract: 2, path, entry: { contentType: "page", ...found }, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

beforeEach(() => {
    forgetCachedReads();
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    bulk = 0;
});

async function urls(): Promise<string[]> {
    return (await createSitemap(config)()).map((e) => e.url);
}

describe("the sitemap of a site with no menu", () => {
    it("lists every published page and the internal targets of HeaderLinks", async () => {
        const listed = await urls();
        expect(listed).toContain(ORIGIN);
        expect(listed).toContain(`${ORIGIN}/about`);
        expect(listed).toContain(`${ORIGIN}/pricing`);
        expect(listed).toContain(`${ORIGIN}/work`);
        expect(listed).toContain(`${ORIGIN}/clients`);
        expect(listed).toHaveLength(new Set(listed).size);
    });

    it("leaves out a noIndex page, a region page, a reserved route, an external link and a page not served at its slug", async () => {
        const listed = await urls();
        expect(listed).not.toContain(`${ORIGIN}/secret`);
        expect(listed).not.toContain(`${ORIGIN}/footer`);
        expect(listed).not.toContain(`${ORIGIN}/feed.xml`);
        expect(listed).not.toContain(`${ORIGIN}/team`);
        expect(listed.some((u) => u.includes("console.example"))).toBe(false);
    });

    it("writes the trailing slash on a build that sets PRESS_TRAILING_SLASH, and not on the home page", async () => {
        vi.stubEnv("PRESS_TRAILING_SLASH", "true");
        const listed = await urls();
        expect(listed[0]).toBe(ORIGIN);
        expect(listed).toContain(`${ORIGIN}/about/`);
        expect(listed).toContain(`${ORIGIN}/pricing/`);
        expect(listed).toContain(`${ORIGIN}/clients/`);
        expect(listed.slice(1).every((u) => u.endsWith("/"))).toBe(true);
    });
});

describe("a URL that carries XML markup characters", () => {
    it("is written escaped, since Next puts the url into <loc> as it is", async () => {
        const listed = await urls();
        expect(listed).toContain(`${ORIGIN}/q&amp;a`);
        expect(listed).not.toContain(`${ORIGIN}/q&a`);
    });
});

describe("a site with more pages than one sitemap file may hold", () => {
    it("stops at 50,000 URLs, the home page included, and says so", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        forgetSitemapWarnings();
        bulk = SITEMAP_MAX_URLS + 5;
        const listed = await urls();
        expect(listed.length).toBeGreaterThan(SITEMAP_MAX_URLS - 10);
        expect(listed).toHaveLength(SITEMAP_MAX_URLS);
        expect(listed[0]).toBe(ORIGIN);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("50000 URLs"));
        warn.mockRestore();
    }, 60_000);
});

describe("the feed", () => {
    async function feed(): Promise<string> {
        return (await createFeed(config)()).text();
    }

    it("links each item as the URL the page is served at on a trailing-slash build", async () => {
        vi.stubEnv("PRESS_TRAILING_SLASH", "true");
        const body = await feed();
        expect(body).toContain("<link>https://studio.example/blog/hello/</link>");
        expect(body).toContain('<guid isPermaLink="true">https://studio.example/blog/hello/</guid>');
    });

    it("keeps the link and the guid as they were on a build without the slash policy", async () => {
        const body = await feed();
        expect(body).toContain("<link>https://studio.example/blog/hello</link>");
        expect(body).toContain('<guid isPermaLink="true">https://studio.example/blog/hello</guid>');
    });
});
