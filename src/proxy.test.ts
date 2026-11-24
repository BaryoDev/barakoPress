import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * The proxy and the path it rewrites to (barakoPress #55).
 *
 * The property every test here is really about is one: a render made for one tenant must never be
 * served to another, and the only thing standing between them is the path, because the path is the
 * whole of Next's render cache key. So the tests check the path, not the rendering: two hosts must
 * never produce one path, and a config resolved from a path must carry that path's tenant.
 *
 * `headers()` throws when nothing set it, which is how the tests assert that a page resolved from
 * its params reads nothing from the request. That is what leaves the render cacheable.
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
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { createPressProxy } = await import("./proxy.js");
const { isPressPath, isRewritten, parseSiteSegment, pressPath, siteSegment } = await import("./site-route.js");
const { showsHoldingPage, siteConfig, siteConfigOrNull, signShareCookie } = await import("./site.js");

const CMS = "http://cms.test";
const SECRET = "a-share-secret-that-is-long-enough-0123456789";

const TENANTS: Record<string, { host?: string; settings: Record<string, unknown>; refused?: boolean }> = {
    rckoronadal: { host: "rckoronadal.org", settings: { Name: "Rotary Club of Koronadal", Url: "https://rckoronadal.org" } },
    baryo: { host: "baryo.dev", settings: { Name: "BaryoDev", Url: "https://baryo.dev" } },
    soon: { host: "soon.example", settings: { Name: "Soon Club", Mode: "Holding", HoldingMessage: "Opening in October" } },
    // No host: a site pinned to it with CMS_TENANT, whose tenant the CMS does not serve yet.
    late: { settings: { Name: "Late Club", Url: "https://late.example" }, refused: true },
};
const NO_TENANT = "This deployment serves registered tenants only.";

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const handle = new Headers(init?.headers).get("x-tenant");
        const tenant = handle ? TENANTS[handle] : undefined;
        if (!tenant) return new Response("", { status: 404 });
        if (tenant.refused) return new Response(NO_TENANT, { status: 404 });
        if (url.pathname === "/api/public/site") {
            return Response.json({
                items: [{ id: "s", data: tenant.settings }],
                page: 1,
                pageSize: 20,
                totalItems: 1,
                totalPages: 1,
                hasNextPage: false,
            });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });

function request(host: string, path = "/", options: { cookie?: string } = {}): NextRequest {
    const headers = new Headers({ host });
    if (options.cookie) headers.set("cookie", options.cookie);
    return new NextRequest(`http://${host}${path}`, { headers });
}

/** The path the proxy rewrote to, or null when it passed the request through untouched. */
function rewriteOf(res: Response): string | null {
    const to = res.headers.get("x-middleware-rewrite");
    return to === null ? null : new URL(to, "http://any.invalid").pathname;
}

beforeEach(() => {
    forgetCachedReads();
    TENANTS.late.refused = true;
    requestHeaders = null;
    requestCookies = {};
    vi.stubEnv("PRESS_SECRET", SECRET);
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("the segment a rewritten path carries", () => {
    it("reads back exactly what was written", () => {
        const route = { tenant: "baryo", gate: "public" as const, host: "baryo.dev" };
        expect(parseSiteSegment(siteSegment(route))).toEqual(route);
    });

    it("keeps a tenant with no host apart from one with a host", () => {
        const pinned = siteSegment({ tenant: "baryo", gate: "public", host: null });
        const byHost = siteSegment({ tenant: "baryo", gate: "public", host: "baryo.dev" });
        expect(pinned).not.toBe(byHost);
        expect(parseSiteSegment(pinned)?.host).toBeNull();
        expect(parseSiteSegment(byHost)?.host).toBe("baryo.dev");
    });

    it("refuses anything it did not write", () => {
        for (const bad of [
            "",
            "baryo",
            "baryo~public",
            "baryo~public~baryo.dev~extra",
            "baryo~open~baryo.dev",
            "ba ryo~public~baryo.dev",
            "baryo~public~../../etc",
            "baryo~public~UPPER.example",
            undefined,
            42,
        ]) {
            expect(parseSiteSegment(bad)).toBeNull();
        }
    });

    it("puts the path under the prefix, and knows one when it sees it", () => {
        const route = { tenant: "baryo", gate: "public" as const, host: "baryo.dev" };
        expect(pressPath(route, "/")).toBe("/_press/baryo~public~baryo.dev");
        expect(pressPath(route, "/blog/x")).toBe("/_press/baryo~public~baryo.dev/blog/x");
        expect(isPressPath(pressPath(route, "/blog/x"))).toBe(true);
        expect(isPressPath("/_press")).toBe(true);
        expect(isPressPath("/_pressing")).toBe(false);
        expect(isPressPath("/blog/x")).toBe(false);
    });

    it("leaves the routes that answer for their own tenant alone", () => {
        for (const path of ["/api/revalidate", "/feed.xml", "/sitemap.xml", "/robots.txt", "/_share", "/_next/static/a.js", "/logo.png"]) {
            expect(isRewritten(path)).toBe(false);
        }
        for (const path of ["/", "/about", "/blog/x", "/about/team"]) {
            expect(isRewritten(path)).toBe(true);
        }
    });
});

describe("the proxy", () => {
    it("sends two hosts to two paths, and neither path names the other's tenant", async () => {
        const proxy = createPressProxy(config);
        const rotary = rewriteOf(await proxy(request("rckoronadal.org", "/")));
        const baryo = rewriteOf(await proxy(request("baryo.dev", "/")));

        expect(rotary).toBe("/_press/rckoronadal~public~rckoronadal.org");
        expect(baryo).toBe("/_press/baryo~public~baryo.dev");
        expect(rotary).not.toBe(baryo);
        expect(rotary).not.toContain("baryo");
        expect(baryo).not.toContain("rckoronadal");
    });

    it("sends one path on two hosts to two paths", async () => {
        const proxy = createPressProxy(config);
        const rotary = rewriteOf(await proxy(request("rckoronadal.org", "/blog/club-news")));
        const baryo = rewriteOf(await proxy(request("baryo.dev", "/blog/club-news")));
        expect(rotary).not.toBe(baryo);
    });

    it("answers a host no tenant owns without naming a tenant", async () => {
        const proxy = createPressProxy(config);
        const to = rewriteOf(await proxy(request("nobody.example", "/")));
        expect(to).toBe("/_press");
        expect(parseSiteSegment(to?.split("/")[2])).toBeNull();
    });

    it("refuses a path that arrives under the prefix", async () => {
        const proxy = createPressProxy(config);
        // Without this, https://baryo.dev/_press/rckoronadal~public~rckoronadal.org/ renders one
        // tenant's site on another tenant's domain.
        const to = rewriteOf(await proxy(request("baryo.dev", "/_press/rckoronadal~public~rckoronadal.org/")));
        expect(to).toBe("/_press");
    });

    it("leaves the routes that resolve their own tenant alone", async () => {
        const proxy = createPressProxy(config);
        for (const path of ["/feed.xml", "/sitemap.xml", "/robots.txt", "/api/revalidate", "/_share"]) {
            expect(rewriteOf(await proxy(request("baryo.dev", path)))).toBeNull();
        }
    });

    it("says no cache between here and the visitor", async () => {
        const proxy = createPressProxy(config);
        const res = await proxy(request("baryo.dev", "/"));
        expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it("puts a valid share session in the path and refuses every other cookie", async () => {
        const proxy = createPressProxy(config);
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const valid = `__Host-press-share=${signShareCookie("soon", expires, SECRET)}`;
        const forAnother = `__Host-press-share=${signShareCookie("baryo", expires, SECRET)}`;
        const expired = `__Host-press-share=${signShareCookie("soon", Math.floor(Date.now() / 1000) - 60, SECRET)}`;

        const gate = async (cookie?: string) =>
            parseSiteSegment(rewriteOf(await proxy(request("soon.example", "/", { cookie })))?.split("/")[2])?.gate;

        expect(await gate(valid)).toBe("shared");
        expect(await gate()).toBe("public");
        expect(await gate(forAnother)).toBe("public");
        expect(await gate(expired)).toBe("public");
        expect(await gate("__Host-press-share=not-a-cookie")).toBe("public");
    });

    it("keeps the query out of the path, so nothing about a draft is in the cache key", async () => {
        const proxy = createPressProxy(config);
        const to = rewriteOf(await proxy(request("baryo.dev", "/blog/x?preview=a-draft-token")));
        expect(to).toBe("/_press/baryo~public~baryo.dev/blog/x");
        expect(to).not.toContain("a-draft-token");
    });

    it("passes a build-time site through", async () => {
        const buildTime = defineConfig({ site: { name: "B", url: "https://b.example" }, cmsUrl: CMS });
        const proxy = createPressProxy(buildTime);
        expect(rewriteOf(await proxy(request("b.example", "/")))).toBeNull();
    });

    it("answers 404 rather than a tenant when the lookup fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("ECONNREFUSED");
            }),
        );
        const proxy = createPressProxy(config);
        expect(rewriteOf(await proxy(request("baryo.dev", "/")))).toBe("/_press");
    });
});

describe("a tenant named without its host", () => {
    const settingsReads = (fetched: ReturnType<typeof cms>) =>
        fetched.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/api/public/site").length;

    beforeEach(() => vi.stubEnv("CMS_TENANT", "late"));
    afterEach(() => vi.useRealTimers());

    it("answers 404 itself while the CMS refuses the tenant, and the site within seconds of it being served", async () => {
        // Only the clock: the store expires by Date.now, and the fetches stay real promises.
        vi.useFakeTimers({ toFake: ["Date"] });
        const proxy = createPressProxy(config);
        // The proxy's 404 is not a render, so nothing for this tenant is put in the page cache.
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press");

        TENANTS.late.refused = false;
        vi.setSystemTime(Date.now() + 6_000);
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press/late~public~-");
    });

    it("asks the CMS about a served tenant once a minute, not once a request", async () => {
        TENANTS.late.refused = false;
        const fetched = cms();
        vi.stubGlobal("fetch", fetched);
        const proxy = createPressProxy(config);
        for (const path of ["/", "/blog/x", "/about"]) await proxy(request("late.example", path));
        expect(settingsReads(fetched)).toBe(1);
    });

    it("lets the page answer when the CMS cannot be asked, and asks again after ten seconds", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const down = vi.fn(async () => {
            throw new Error("ECONNREFUSED");
        });
        vi.stubGlobal("fetch", down);
        const proxy = createPressProxy(config);
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press/late~public~-");
        await proxy(request("late.example", "/"));
        expect(down).toHaveBeenCalledTimes(1);

        const fetched = cms();
        vi.stubGlobal("fetch", fetched);
        vi.setSystemTime(Date.now() + 11_000);
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press");
        expect(settingsReads(fetched)).toBe(1);
    });

    it("asks again after ten seconds when the CMS answers with an error, not after a minute", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const busy = vi.fn(async () => new Response("", { status: 503 }));
        vi.stubGlobal("fetch", busy);
        const proxy = createPressProxy(config);
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press/late~public~-");

        const fetched = cms();
        vi.stubGlobal("fetch", fetched);
        vi.setSystemTime(Date.now() + 11_000);
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press");
        expect(settingsReads(fetched)).toBe(1);
    });

    it("lets the page answer when the store fails, rather than failing the request", async () => {
        const broken = {
            get: () => {
                throw new Error("store down");
            },
            set: async () => {
                throw new Error("store down");
            },
            delete: async () => {},
            add: async () => false,
        };
        TENANTS.late.refused = false;
        const proxy = createPressProxy(defineConfig({ sites: {}, cmsUrl: CMS, store: broken }));
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press/late~public~-");
    });

    it("takes a 404 that is not the CMS refusing the tenant as served", async () => {
        // A tenant with no site settings type is served all the same; the page renders its defaults.
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
        const proxy = createPressProxy(config);
        expect(rewriteOf(await proxy(request("late.example", "/")))).toBe("/_press/late~public~-");
    });

    it("does not ask about a tenant its host already resolved", async () => {
        vi.unstubAllEnvs();
        vi.stubEnv("PRESS_SECRET", SECRET);
        const fetched = cms();
        vi.stubGlobal("fetch", fetched);
        const proxy = createPressProxy(config);
        expect(rewriteOf(await proxy(request("baryo.dev", "/")))).toBe("/_press/baryo~public~baryo.dev");
        expect(settingsReads(fetched)).toBe(0);
    });
});

describe("a page resolved from its path", () => {
    const paramsFor = (tenant: string, gate: "public" | "shared", host: string | null) => ({
        site: siteSegment({ tenant, gate, host }),
    });

    it("renders the tenant the path names, without reading the request", async () => {
        // requestHeaders is null, so headers() throws. Getting an answer is the assertion.
        const rotary = await siteConfig(config, paramsFor("rckoronadal", "public", "rckoronadal.org"));
        const baryo = await siteConfig(config, paramsFor("baryo", "public", "baryo.dev"));
        expect(rotary.site.name).toBe("Rotary Club of Koronadal");
        expect(baryo.site.name).toBe("BaryoDev");
        expect(rotary.tenant).toBe("rckoronadal");
        expect(baryo.tenant).toBe("baryo");
    });

    it("reads the host out of the path, so two hosts on one tenant keep their own origin", async () => {
        const settings = TENANTS.baryo.settings;
        try {
            TENANTS.baryo.settings = { Name: "BaryoDev" };
            const one = await siteConfig(config, paramsFor("baryo", "public", "baryo.dev"));
            forgetCachedReads();
            const two = await siteConfig(config, paramsFor("baryo", "public", "www.baryo.dev"));
            expect(one.site.url).toBe("https://baryo.dev");
            expect(two.site.url).toBe("https://www.baryo.dev");
        } finally {
            TENANTS.baryo.settings = settings;
        }
    });

    it("falls back to the request only when the path carries nothing it wrote", async () => {
        requestHeaders = new Headers({ host: "baryo.dev" });
        const fromRequest = await siteConfigOrNull(config, { site: "not-a-segment" });
        expect(fromRequest?.site.name).toBe("BaryoDev");
    });

    it("shows a holding tenant its holding page, and the real site behind a share session", async () => {
        const held = await siteConfigOrNull(config, paramsFor("soon", "public", "soon.example"));
        expect(await showsHoldingPage(held!, paramsFor("soon", "public", "soon.example"))).toBe(true);
        const shared = await siteConfigOrNull(config, paramsFor("soon", "shared", "soon.example"));
        expect(await showsHoldingPage(shared!, paramsFor("soon", "shared", "soon.example"))).toBe(false);
    });

    it("reads the cookie only for a page the proxy did not rewrite", async () => {
        requestHeaders = new Headers({ host: "soon.example" });
        const held = await siteConfigOrNull(config, undefined);
        requestCookies = {};
        expect(await showsHoldingPage(held!)).toBe(true);
        const expires = Math.floor(Date.now() / 1000) + 3600;
        requestCookies = { "__Host-press-share": signShareCookie("soon", expires, SECRET) };
        expect(await showsHoldingPage(held!)).toBe(false);
    });
});
