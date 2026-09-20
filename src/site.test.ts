import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The request is whatever the test says it is. `headers()` throwing when nothing set it is the
 * assertion that a build-time site never reads the request at all.
 */
let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));

const { defineConfig } = await import("./config.js");
const { listPosts } = await import("./cms.js");
const { forgetCachedReads, tenantForHost } = await import("./delivery.js");
const { applySiteSettings, normaliseHost, resolveSite, siteConfig, tenantFromHeaders } = await import("./site.js");
const { createFeed } = await import("./routes/feed.js");
const { createSitemap } = await import("./routes/sitemap.js");
const { createRobots } = await import("./routes/robots.js");
const { DEFAULT_THEME } = await import("./theme.js");

const CMS = "http://cms.test";

/* A CMS with two tenants on two domains, each with its own settings and its own posts. */
const TENANTS: Record<string, { host: string; settings: Record<string, unknown>; post: string }> = {
    rckoronadal: {
        host: "rckoronadal.org",
        settings: {
            Name: "Rotary Club of Koronadal",
            Url: "https://rckoronadal.org",
            Locale: "en-PH",
            Colors: { accent: "#17458F", royalBlue: "#17458F" },
            Fonts: { heading: "Zilla Slab" },
        },
        post: "club-news",
    },
    baryo: {
        host: "baryo.dev",
        settings: {
            Name: "BaryoDev",
            Url: "https://baryo.dev",
            // A JSON field saved as text, which is how some editors send it.
            Colors: JSON.stringify({ accent: "#1A6B41" }),
            Fonts: { heading: "Sora" },
        },
        post: "shipping-notes",
    },
};

type Call = { url: string; tenant: string | null; tags: string[] };

function cms(options: { down?: boolean } = {}) {
    const calls: Call[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push({ url: url.pathname + url.search, tenant, tags: init?.next?.tags ?? [] });
        if (options.down) throw new Error("ECONNREFUSED");

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }

        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        const page = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") return page([{ id: "s", data: t.settings }]);
        if (url.pathname === "/api/public/post")
            return page([{ id: t.post, slug: t.post, data: { Title: `${t.settings.Name} post`, Slug: t.post, Body: "x" } }]);
        return new Response("", { status: 404 });
    });
    return { calls, fetchMock };
}

const requestTime = () => defineConfig({ sites: {}, cmsUrl: CMS });

function onHost(host: string, extra: Record<string, string> = {}) {
    requestHeaders = new Headers({ host, ...extra });
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("a build-time site", () => {
    const buildTime = defineConfig({
        site: { name: "barakoCMS", tagline: "Notes", url: "https://barakocms.com" },
        routes: { post: "/blog", author: undefined, category: undefined },
        cmsUrl: CMS,
    });

    it("builds the same config it always did", () => {
        expect(buildTime.sites).toBeUndefined();
        expect("sites" in buildTime).toBe(false);
        expect(buildTime.site).toEqual({ name: "barakoCMS", tagline: "Notes", url: "https://barakocms.com" });
        expect(buildTime.theme).toEqual(DEFAULT_THEME);
        expect(buildTime.cacheTag).toBe("cms");
    });

    it("resolves to its own config without reading the request or the CMS", async () => {
        const { calls, fetchMock } = cms();
        vi.stubGlobal("fetch", fetchMock);

        // requestHeaders is null, so reading the request would throw.
        await expect(siteConfig(buildTime)).resolves.toBe(buildTime);
        expect(calls).toHaveLength(0);
    });

    it("renders feed, sitemap and robots from press.config.ts identity with the one configured tag", async () => {
        const { calls, fetchMock } = cms();
        vi.stubGlobal("fetch", fetchMock);
        // A build-time site on a multi-tenant CMS names its tenant with CMS_TENANT, as it always could.
        const pinned = { ...buildTime, tenant: "baryo" };

        const feed = await (await createFeed(pinned)()).text();
        const sitemap = await createSitemap(pinned)();
        const robots = await createRobots(pinned)();

        expect(feed).toContain("<title>barakoCMS</title>");
        expect(feed).toContain("https://barakocms.com/blog/shipping-notes");
        expect(sitemap[0].url).toBe("https://barakocms.com");
        expect(robots.sitemap).toBe("https://barakocms.com/sitemap.xml");

        expect(calls).toHaveLength(2);
        for (const call of calls) {
            expect(call.url.startsWith("/api/public/post")).toBe(true);
            // The configured tag, and the type's, which is what a purge naming the type drops (#56).
            expect(call.tags).toEqual(["cms", "cms:type:post"]);
        }
    });
});

describe("normaliseHost", () => {
    it("lowercases and drops the port and a trailing dot", () => {
        expect(normaliseHost("BaryO.dev:443")).toBe("baryo.dev");
        expect(normaliseHost("baryo.dev.")).toBe("baryo.dev");
    });

    it("refuses anything that is not a DNS name", () => {
        for (const bad of ["", "a/b", "../x", "[::1]:3000", "a..b", "x".repeat(254), "exa mple.com"]) {
            expect(normaliseHost(bad)).toBeNull();
        }
    });
});

describe("resolving the tenant", () => {
    it("finds each tenant by its own host", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = requestTime();

        expect(await tenantFromHeaders(config, new Headers({ host: "rckoronadal.org" }))).toEqual({
            tenant: "rckoronadal",
            host: "rckoronadal.org",
        });
        expect((await tenantFromHeaders(config, new Headers({ host: "baryo.dev" })))?.tenant).toBe("baryo");
    });

    it("gives a host with no tenant nothing, and the page a 404", async () => {
        const { calls, fetchMock } = cms();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubEnv("CMS_DEFAULT_TENANT", "");

        expect(await tenantFromHeaders(requestTime(), new Headers({ host: "unknown.example" }))).toBeNull();
        onHost("unknown.example");
        await expect(siteConfig(requestTime())).rejects.toThrow("NEXT_NOT_FOUND");
        // No settings or content read happened for a request that belongs to nobody.
        expect(calls.filter((c) => !c.url.startsWith("/api/tenants/by-host/"))).toHaveLength(0);
    });

    it("gives the feed for a host with no tenant a 404", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        onHost("unknown.example");

        const res = await createFeed(requestTime())();
        expect(res.status).toBe(404);
    });

    it("sends a host with no tenant to the configured default", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = defineConfig({ sites: { defaultTenant: "baryo" }, cmsUrl: CMS });

        expect((await tenantFromHeaders(config, new Headers({ host: "unknown.example" })))?.tenant).toBe("baryo");
    });

    it("reads the default from CMS_DEFAULT_TENANT at request time", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = requestTime();
        vi.stubEnv("CMS_DEFAULT_TENANT", "baryo");

        expect((await tenantFromHeaders(config, new Headers({ host: "unknown.example" })))?.tenant).toBe("baryo");
    });

    it("never takes a tenant from a request header the operator did not name", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const forged = new Headers({
            host: "unknown.example",
            "x-tenant": "baryo",
            "x-forwarded-host": "baryo.dev",
            "x-press-tenant": "baryo",
        });

        expect(await tenantFromHeaders(requestTime(), forged)).toBeNull();
    });

    it("takes the tenant from a header only when one is configured", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = defineConfig({ sites: { tenantHeader: "X-Press-Tenant" }, cmsUrl: CMS });

        expect(
            (await tenantFromHeaders(config, new Headers({ host: "unknown.example", "x-press-tenant": "baryo" })))?.tenant,
        ).toBe("baryo");
        // A value that is not a handle is ignored rather than sent to the CMS.
        expect(
            await tenantFromHeaders(config, new Headers({ host: "unknown.example", "x-press-tenant": "../admin" })),
        ).toBeNull();
    });

    it("reads the host from a forwarded header only when one is configured", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = defineConfig({ sites: { hostHeader: "X-Forwarded-Host" }, cmsUrl: CMS });

        expect(
            (await tenantFromHeaders(config, new Headers({ host: "internal:3000", "x-forwarded-host": "baryo.dev" })))
                ?.tenant,
        ).toBe("baryo");
    });

    it("pins every host to CMS_TENANT without a lookup", async () => {
        const { calls, fetchMock } = cms();
        vi.stubGlobal("fetch", fetchMock);
        const config = defineConfig({ sites: {}, tenant: "rckoronadal", cmsUrl: CMS });

        expect((await tenantFromHeaders(config, new Headers({ host: "baryo.dev" })))?.tenant).toBe("rckoronadal");
        expect(calls).toHaveLength(0);
    });

    it("keeps resolving a known host while the CMS is down", async () => {
        const up = cms();
        vi.stubGlobal("fetch", up.fetchMock);
        const config = requestTime();
        await tenantFromHeaders(config, new Headers({ host: "baryo.dev" }));

        vi.stubGlobal("fetch", cms({ down: true }).fetchMock);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000);

        expect((await tenantFromHeaders(config, new Headers({ host: "baryo.dev" })))?.tenant).toBe("baryo");
        await expect(tenantFromHeaders(config, new Headers({ host: "rckoronadal.org" }))).rejects.toThrow("ECONNREFUSED");
    });
});

describe("one build serving two sites", () => {
    it("renders two hosts with two names, palettes, fonts and locales", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = requestTime();

        const rotary = await resolveSite(config, new Headers({ host: "rckoronadal.org" }));
        const baryo = await resolveSite(config, new Headers({ host: "baryo.dev" }));

        expect(rotary?.site.name).toBe("Rotary Club of Koronadal");
        expect(baryo?.site.name).toBe("BaryoDev");
        expect(rotary?.theme.colors.accent).toBe("#17458F");
        expect(baryo?.theme.colors.accent).toBe("#1A6B41");
        expect(rotary?.theme.fonts.heading.startsWith("'Zilla Slab',")).toBe(true);
        expect(baryo?.theme.fonts.heading.startsWith("'Sora',")).toBe(true);
        expect(rotary?.locale).toBe("en-PH");
        expect(baryo?.locale).toBe("en-GB");
        // The palette slots not set stay at the configured theme, not blank.
        expect(rotary?.theme.colors.ink).toBe(DEFAULT_THEME.colors.ink);
    });

    it("renders feed, sitemap and robots for the tenant the host resolved to", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = requestTime();

        onHost("baryo.dev");
        const feed = await (await createFeed(config)()).text();
        const sitemap = await createSitemap(config)();
        const robots = await createRobots(config)();

        expect(feed).toContain("<title>BaryoDev</title>");
        expect(feed).toContain("https://baryo.dev/blog/shipping-notes");
        expect(feed).not.toContain("club-news");
        expect(sitemap.map((e) => e.url)).toEqual(["https://baryo.dev", "https://baryo.dev/blog/shipping-notes"]);
        expect(robots.sitemap).toBe("https://baryo.dev/sitemap.xml");

        onHost("rckoronadal.org");
        const other = await (await createFeed(config)()).text();
        expect(other).toContain("<title>Rotary Club of Koronadal</title>");
        expect(other).not.toContain("shipping-notes");
    });

    it("puts the tenant in the header and the cache tag of every read", async () => {
        const { calls, fetchMock } = cms();
        vi.stubGlobal("fetch", fetchMock);
        const config = requestTime();

        const a = await resolveSite(config, new Headers({ host: "rckoronadal.org" }));
        const b = await resolveSite(config, new Headers({ host: "baryo.dev" }));
        await listPosts(a!);
        await listPosts(b!);

        const reads = calls.filter((c) => c.url.startsWith("/api/public/"));
        expect(reads).toHaveLength(4);
        for (const read of reads) {
            expect(read.tenant).not.toBeNull();
            // The tenant's tag on every read, whatever narrower tag it carries beside it.
            expect(read.tags[0]).toBe(`cms:${read.tenant}`);
            expect(read.tags.every((tag) => tag.startsWith(`cms:${read.tenant}`))).toBe(true);
        }
        const posts = reads.filter((r) => r.url.startsWith("/api/public/post"));
        expect(posts.map((r) => r.tenant)).toEqual(["rckoronadal", "baryo"]);
        // Same path, different tag, so a purge of one cannot drop the other.
        expect(posts[0].url).toBe(posts[1].url);
        expect(posts[0].tags).not.toEqual(posts[1].tags);
    });

    it("refuses to read with a request-time config that was never resolved", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        await expect(listPosts(requestTime())).rejects.toThrow("resolved");
    });
});

describe("the feed behind a shared cache", () => {
    it("varies on a tenant header and on a host header other than host, since the URL names neither", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);

        onHost("anything.example", { "x-press-tenant": "baryo" });
        const byTenant = await createFeed(defineConfig({ sites: { tenantHeader: "X-Press-Tenant" }, cmsUrl: CMS }))();
        expect(await byTenant.text()).toContain("https://baryo.dev/blog/shipping-notes");
        expect(byTenant.headers.get("vary")).toBe("x-press-tenant");

        onHost("internal", { "x-forwarded-host": "baryo.dev" });
        const byHost = await createFeed(defineConfig({ sites: { hostHeader: "X-Forwarded-Host" }, cmsUrl: CMS }))();
        expect(await byHost.text()).toContain("https://baryo.dev/blog/shipping-notes");
        expect(byHost.headers.get("vary")).toBe("x-forwarded-host");
    });

    it("adds no Vary when the host header alone picks the tenant", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        onHost("baryo.dev");
        const res = await createFeed(requestTime())();
        expect(await res.text()).toContain("https://baryo.dev/blog/shipping-notes");
        expect(res.headers.get("vary")).toBeNull();
    });
});

describe("while the CMS is down", () => {
    it("serves each tenant its own last good pages, identity and theme", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = requestTime();
        onHost("baryo.dev");
        const warm = await (await createFeed(config)()).text();
        expect(warm).toContain("shipping-notes");

        vi.stubGlobal("fetch", cms({ down: true }).fetchMock);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const site = await siteConfig(config);
        const feed = await (await createFeed(config)()).text();

        expect(site.site.name).toBe("BaryoDev");
        expect(site.theme.colors.accent).toBe("#1A6B41");
        expect(feed).toContain("<title>BaryoDev</title>");
        expect(feed).toContain("https://baryo.dev/blog/shipping-notes");
        expect(warn).toHaveBeenCalled();
    });

    it("never serves one tenant's kept answer to another tenant", async () => {
        vi.stubGlobal("fetch", cms().fetchMock);
        const config = requestTime();
        const baryo = await resolveSite(config, new Headers({ host: "baryo.dev" }));
        await listPosts(baryo!);

        vi.stubGlobal("fetch", cms({ down: true }).fetchMock);
        vi.spyOn(console, "warn").mockImplementation(() => {});

        // Same path, same CMS, a tenant that never read it while the CMS was up.
        const other = { ...baryo!, tenant: "rckoronadal" };
        await expect(listPosts(other)).rejects.toThrow("ECONNREFUSED");
        await expect(listPosts(baryo!)).resolves.toMatchObject({ posts: [{ slug: "shipping-notes" }] });
    });

    it("keeps a host's tenant for another minute after a failed lookup, instead of asking again on every request", async () => {
        const config = requestTime();
        let now = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        vi.stubGlobal("fetch", cms().fetchMock);
        expect(await tenantForHost(config, "baryo.dev")).toBe("baryo");

        const down = cms({ down: true });
        vi.stubGlobal("fetch", down.fetchMock);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        now += 61_000;
        expect(await tenantForHost(config, "baryo.dev")).toBe("baryo");
        now += 1_000;
        expect(await tenantForHost(config, "baryo.dev")).toBe("baryo");
        now += 1_000;
        expect(await tenantForHost(config, "baryo.dev")).toBe("baryo");

        expect(down.calls).toHaveLength(1);
        now += 61_000;
        expect(await tenantForHost(config, "baryo.dev")).toBe("baryo");
        expect(down.calls).toHaveLength(2);
    });

    it("replaces the kept answer on the next successful read", async () => {
        const config = requestTime();
        let title = "first";
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            if (title === "down") throw new Error("ECONNREFUSED");
            const items = [{ id: "1", slug: "p", data: { Title: title, Slug: "p", Body: "" } }];
            void input;
            return Response.json({ items, page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false });
        });
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const site = { ...config, tenant: "baryo" };

        await listPosts(site);
        title = "second";
        await listPosts(site);
        title = "down";

        expect((await listPosts(site)).posts[0].title).toBe("second");
    });
});

describe("applySiteSettings", () => {
    const base = { ...defineConfig({ sites: {}, site: { name: "Fallback" }, theme: { colors: { accent: "#000001" } } }), tenant: "t" };

    it("keeps the configured links, footer columns and social links when a field is not a list, and clears them when it is an empty one", () => {
        const configured = {
            ...base,
            site: {
                ...base.site,
                headerLinks: [{ label: "Home", href: "/" }],
                footerColumns: [{ heading: "Club", links: [{ label: "About", href: "/about" }] }],
                socialLinks: [{ network: "facebook", href: "https://facebook.com/x" }],
            },
        };

        for (const wrong of ["[not json", { label: "Home" }, 5, "\"text\"", null]) {
            const out = applySiteSettings(configured, { HeaderLinks: wrong, FooterColumns: wrong, SocialLinks: wrong }, null);
            expect(out.site.headerLinks).toHaveLength(1);
            expect(out.site.headerLinks).toEqual(configured.site.headerLinks);
            expect(out.site.footerColumns).toHaveLength(1);
            expect(out.site.footerColumns).toEqual(configured.site.footerColumns);
            expect(out.site.socialLinks).toHaveLength(1);
            expect(out.site.socialLinks).toEqual(configured.site.socialLinks);
        }

        const cleared = applySiteSettings(configured, { HeaderLinks: [], FooterColumns: "[]", SocialLinks: [] }, null);
        expect(cleared.site.headerLinks).toEqual([]);
        expect(cleared.site.footerColumns).toEqual([]);
        expect(cleared.site.socialLinks).toEqual([]);
    });

    it("falls back to the configured identity and theme when there are no settings", () => {
        const out = applySiteSettings(base, undefined, "t.example");
        expect(out.site.name).toBe("Fallback");
        expect(out.site.url).toBe("https://t.example");
        expect(out.theme.colors.accent).toBe("#000001");
    });

    it("drops values that could carry markup or a script", () => {
        const out = applySiteSettings(
            base,
            {
                Name: "T",
                Url: "javascript:alert(1)",
                Logo: "javascript:alert(1)",
                Colors: { accent: "red;}</style><script>", ink: "#123" },
                Fonts: { heading: "x'</style>" },
                Radii: { panel: "calc(1px)" },
                HeaderLinks: [
                    { label: "Ok", href: "/about" },
                    { label: "Bad", href: "javascript:alert(1)" },
                    { label: "Protocol relative", href: "//evil.example" },
                ],
                SocialLinks: [{ network: "facebook", href: "https://facebook.com/x" }],
            },
            null,
        );
        expect(out.site.url).toBe("");
        expect(out.site.logo).toBeUndefined();
        expect(out.theme.colors.accent).toBe("#000001");
        expect(out.theme.colors.ink).toBe("#123");
        expect(out.theme.fonts.heading).toBe(DEFAULT_THEME.fonts.heading);
        expect(out.theme.radii.panel).toBe(DEFAULT_THEME.radii.panel);
        expect(out.site.headerLinks).toEqual([{ label: "Ok", href: "/about" }]);
        expect(out.site.socialLinks).toHaveLength(1);
    });

    it("reads the chrome fields the site blueprint defines", () => {
        const out = applySiteSettings(
            base,
            {
                Name: "Club",
                Tagline: "Service above self",
                Copyright: "2026 Club",
                Favicon: "https://files.example/f.png",
                TopBar: { text: "City of Koronadal", links: [{ label: "Facebook", href: "https://facebook.com/x" }] },
                FooterColumns: [{ heading: "Club", links: [{ label: "About", href: "/about" }] }],
                Layout: { prose: "680px" },
            },
            null,
        );
        expect(out.site.tagline).toBe("Service above self");
        expect(out.site.copyright).toBe("2026 Club");
        expect(out.site.favicon).toBe("https://files.example/f.png");
        expect(out.site.topBar).toEqual({ text: "City of Koronadal", links: [{ label: "Facebook", href: "https://facebook.com/x" }] });
        expect(out.site.footerColumns).toHaveLength(1);
        expect(out.site.footerColumns?.[0].links).toEqual([{ label: "About", href: "/about" }]);
        expect(out.theme.layout.prose).toBe("680px");
    });
});
