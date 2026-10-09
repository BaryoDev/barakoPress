import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Share links to the site, to one entry and to one page (barakoCMS #1089), from `/_share#key` to what
 * the visitor sees. barakoCMS 4.6 answers all three on one route, `share-links/open`, and the API here
 * is that one: every answer carries its delivery contract, as 4.7 sends it.
 */

let requestCookies: Record<string, string> = {};
vi.mock("next/headers", () => ({
    headers: async () => {
        throw new Error("headers() was read");
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
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads, openShareLink } = await import("./delivery.js");
const { LINK_COOKIE, SHARE_COOKIE, openLinkCookie, sealLinkCookie, shareCookieValid } = await import("./site.js");
const { createShareRedeemRoute } = await import("./routes/share.js");
const { createPressProxy } = await import("./proxy.js");
const { siteSegment } = await import("./site-route.js");
const { createSharedLinkPage } = await import("./screens/shared-link.js");

const CMS = "http://cms.test";
const SECRET = "a-share-secret-that-is-long-enough-0123456789";
const SITE_KEY = "site-key-for-tests-0123456789abcdef";
const ENTRY_KEY = "entry-key-for-tests-0123456789abcdef";
const PAGE_KEY = "page-key-for-tests-0123456789abcdef";
const REVOKED_KEY = "revoked-key-for-tests-0123456789abcd";
const HOUR = 60 * 60;

const DRAFT = { id: "d1", slug: "draft-notes", contentType: "post", data: { Title: "Draft notes", Slug: "draft-notes", Body: "Not yet published." } };
const ABOUT = { id: "p1", slug: "about", contentType: "page", data: { Title: "About us, the draft", Body: "A page nobody has published." } };

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    soon: { host: "soon.example", settings: { Name: "Soon Club", Url: "https://soon.example", Mode: "Holding" } },
    baryo: { host: "baryo.dev", settings: { Name: "BaryoDev", Url: "https://baryo.dev", Mode: "Live" } },
};

/** What each key opens, by tenant. A key missing here is a wrong, expired or revoked one: a 404. */
let links: Record<string, Record<string, unknown>> = {};
/** What the post type's description answers. Unset, a 404, as from an API older than 4.7. */
let postDescription: unknown;
let opens: string[] = [];
let redeems = 0;

const contract = { "X-Delivery-Contract-Version": "7" };
const inAnHour = () => new Date(Date.now() + HOUR * 1000).toISOString();

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }, { headers: contract }) : new Response("", { status: 404, headers: contract });
        }
        const tenant = new Headers(init?.headers).get("x-tenant") ?? "";
        if (url.pathname === "/api/public/site/share-links/open") {
            const key = JSON.parse(String(init?.body)).key as string;
            opens.push(key);
            const answer = links[tenant]?.[key];
            return answer ? Response.json(answer, { headers: contract }) : new Response("", { status: 404, headers: contract });
        }
        if (url.pathname === "/api/public/site/share-links/redeem") {
            redeems++;
            return new Response("", { status: 404, headers: contract });
        }
        if (url.pathname === "/api/public/types/post/description" && postDescription) {
            return Response.json(postDescription, { headers: contract });
        }
        if (url.pathname === "/api/public/site" && TENANTS[tenant]) {
            return Response.json(
                { items: [{ id: "s", data: TENANTS[tenant].settings }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false },
                { headers: contract },
            );
        }
        return new Response("", { status: 404, headers: contract });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });

beforeEach(() => {
    forgetCachedReads();
    requestCookies = {};
    opens = [];
    redeems = 0;
    postDescription = undefined;
    const live = () => ({
        [SITE_KEY]: { scope: "site", expiresAt: inAnHour(), path: null, entry: null },
        [ENTRY_KEY]: { scope: "entry", expiresAt: inAnHour(), path: null, entry: DRAFT },
        [PAGE_KEY]: { scope: "page", expiresAt: inAnHour(), path: "/about", entry: ABOUT },
    });
    links = { soon: live(), baryo: live() };
    vi.stubEnv("PRESS_SECRET", SECRET);
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const redeem = (host: string, key: string) =>
    createShareRedeemRoute(config)(
        new Request("http://internal:3000/api/share/redeem", {
            method: "POST",
            headers: { host, "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ key }).toString(),
        }),
    );

const cookieOf = (res: Response, name: string): string | null => {
    const set = res.headers.get("set-cookie") ?? "";
    return set.startsWith(`${name}=`) ? set.slice(name.length + 1, set.indexOf(";")) : null;
};

describe("opening a key with the API", () => {
    it("reads each scope, and the entry or the path it opens", async () => {
        const site = defineConfig({ cmsUrl: CMS, tenant: "baryo", site: { name: "B", url: "https://baryo.dev" } });

        expect(await openShareLink(site, SITE_KEY)).toMatchObject({ kind: "site" });
        expect(await openShareLink(site, ENTRY_KEY)).toMatchObject({ kind: "entry", entry: { id: "d1" } });
        expect(await openShareLink(site, PAGE_KEY)).toMatchObject({ kind: "page", path: "/about", entry: { id: "p1" } });
    });

    it("tells an expired or revoked key from an API that has no such route", async () => {
        const site = defineConfig({ cmsUrl: CMS, tenant: "baryo", site: { name: "B", url: "https://baryo.dev" } });
        expect(await openShareLink(site, REVOKED_KEY)).toEqual({ kind: "invalid", older: false });

        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
        expect(await openShareLink(site, REVOKED_KEY)).toEqual({ kind: "invalid", older: true });
    });

    it("refuses a page path that could leave the site", async () => {
        links.baryo[PAGE_KEY] = { scope: "page", expiresAt: inAnHour(), path: "//elsewhere.example/x", entry: ABOUT };
        const site = defineConfig({ cmsUrl: CMS, tenant: "baryo", site: { name: "B", url: "https://baryo.dev" } });

        expect(await openShareLink(site, PAGE_KEY)).toEqual({ kind: "failed" });
    });
});

describe("the sealed link cookie", () => {
    const session = { tenant: "baryo", key: ENTRY_KEY, path: "/blog/draft-notes", expires: Math.floor(Date.now() / 1000) + HOUR };

    it("opens for its own tenant and holds the key without showing it", () => {
        const value = sealLinkCookie(session, SECRET)!;

        expect(value).not.toContain(ENTRY_KEY);
        expect(openLinkCookie(value, "baryo", SECRET)).toEqual(session);
    });

    it("opens nothing for another tenant, another secret, an altered value or a past expiry", () => {
        const value = sealLinkCookie(session, SECRET)!;
        const altered = `${value.slice(0, -2)}${value.endsWith("AA") ? "BB" : "AA"}`;
        const expired = sealLinkCookie({ ...session, expires: Math.floor(Date.now() / 1000) - 1 }, SECRET)!;

        expect(openLinkCookie(value, "soon", SECRET)).toBeNull();
        expect(openLinkCookie(value, "baryo", `${SECRET}-other`)).toBeNull();
        expect(openLinkCookie(altered, "baryo", SECRET)).toBeNull();
        expect(openLinkCookie(expired, "baryo", SECRET)).toBeNull();
    });
});

describe("redeeming a key at /api/share/redeem", () => {
    it("starts a site session for a site key on a holding tenant, as before", async () => {
        const res = await redeem("soon.example", SITE_KEY);

        expect(res.headers.get("location")).toBe("/");
        expect(shareCookieValid(cookieOf(res, SHARE_COOKIE), "soon", SECRET)).toBe(true);
        expect(redeems).toBe(0);
    });

    it("sends an entry key to the entry's page, with the key sealed in a cookie and in no URL", async () => {
        const res = await redeem("baryo.dev", ENTRY_KEY);

        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/blog/draft-notes");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        const set = res.headers.get("set-cookie") ?? "";
        for (const part of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(set).toContain(`; ${part}`);
        expect(set).not.toContain(ENTRY_KEY);
        expect(res.headers.get("location")).not.toContain(ENTRY_KEY);
        expect(openLinkCookie(cookieOf(res, LINK_COOKIE), "baryo", SECRET)).toMatchObject({ key: ENTRY_KEY, path: "/blog/draft-notes" });
    });

    it("opens nothing for an entry whose slug holds a slash, since no item route matches it", async () => {
        links.baryo[ENTRY_KEY] = { scope: "entry", expiresAt: inAnHour(), path: null, entry: { ...DRAFT, slug: "notes/draft" } };
        const res = await redeem("baryo.dev", ENTRY_KEY);

        expect(res.headers.get("location")).toBe("/#share-invalid");
        expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("sends a page key to the path it was made for, on a holding tenant too", async () => {
        const res = await redeem("soon.example", PAGE_KEY);

        expect(res.headers.get("location")).toBe("/about");
        expect(openLinkCookie(cookieOf(res, LINK_COOKIE), "soon", SECRET)).toMatchObject({ key: PAGE_KEY, path: "/about" });
    });

    it("sets nothing for an expired or revoked key, and does not fall back to the old route on 4.6", async () => {
        const res = await redeem("soon.example", REVOKED_KEY);

        expect(res.headers.get("location")).toBe("/#share-invalid");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(redeems).toBe(0);
    });

    it("never logs a key", async () => {
        const logged: unknown[][] = [];
        for (const level of ["log", "info", "warn", "error", "debug"] as const) {
            vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
        }
        for (const key of [SITE_KEY, ENTRY_KEY, PAGE_KEY, REVOKED_KEY]) await redeem("baryo.dev", key);
        links.baryo[ENTRY_KEY] = { scope: "entry", expiresAt: inAnHour(), path: null, entry: { ...DRAFT, contentType: "unrouted" } };
        await redeem("baryo.dev", ENTRY_KEY);

        expect(logged.length).toBeGreaterThan(0);
        for (const args of logged) {
            const line = args.map(String).join(" ");
            for (const key of [SITE_KEY, ENTRY_KEY, PAGE_KEY, REVOKED_KEY]) expect(line).not.toContain(key);
        }
    });
});

describe("the proxy, for a visitor holding a link", () => {
    const sealed = (tenant: string, path: string, key = ENTRY_KEY) =>
        sealLinkCookie({ tenant, key, path, expires: Math.floor(Date.now() / 1000) + HOUR }, SECRET)!;
    const visit = (host: string, path: string, cookie: string) =>
        createPressProxy(config)(new NextRequest(`http://${host}${path}`, { headers: { host, cookie: `${LINK_COOKIE}=${cookie}` } }));
    const rewriteOf = (res: Response) => {
        const to = res.headers.get("x-middleware-rewrite");
        return to === null ? null : new URL(to, "http://any.invalid").pathname;
    };

    it("sends the path the link opens at to the link route, unindexed and unkept", async () => {
        const res = await visit("baryo.dev", "/blog/draft-notes", sealed("baryo", "/blog/draft-notes"));

        expect(rewriteOf(res)).toBe("/_press/baryo~link~baryo.dev/_link/blog/draft-notes");
        expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    it("leaves every other path, and another tenant's cookie, to the site as it is", async () => {
        expect(rewriteOf(await visit("baryo.dev", "/blog/other", sealed("baryo", "/blog/draft-notes")))).toBe(
            "/_press/baryo~public~baryo.dev/blog/other",
        );
        expect(rewriteOf(await visit("baryo.dev", "/blog/draft-notes", sealed("soon", "/blog/draft-notes")))).toBe(
            "/_press/baryo~public~baryo.dev/blog/draft-notes",
        );
    });
});

describe("the link route", () => {
    const Page = createSharedLinkPage(config);
    const params = (gate: "link" | "public", path: string[]) =>
        Promise.resolve({ site: siteSegment({ tenant: "baryo", gate, host: "baryo.dev" }), path });
    const holding = (path: string, key: string) => {
        requestCookies = {
            [LINK_COOKIE]: sealLinkCookie({ tenant: "baryo", key, path, expires: Math.floor(Date.now() / 1000) + HOUR }, SECRET)!,
        };
    };
    const html = async (node: ReturnType<typeof Page>) => renderToStaticMarkup(await node);

    it("draws the unpublished entry an entry link opens", async () => {
        holding("/blog/draft-notes", ENTRY_KEY);

        const out = await html(Page({ params: params("link", ["blog", "draft-notes"]) }));

        expect(out).toContain("Draft notes");
        expect(out).toContain("Not yet published.");
        expect(opens).toEqual([ENTRY_KEY]);
    });

    it("reads the entry through the type's roles and draws its structured data, as the live page does", async () => {
        postDescription = { name: "post", routeTemplate: "/blog/{slug}", fields: [{ name: "Headline", type: "string", role: "title" }] };
        links.baryo[ENTRY_KEY] = {
            scope: "entry",
            expiresAt: inAnHour(),
            path: null,
            entry: {
                ...DRAFT,
                data: { ...DRAFT.data, Headline: "The draft headline" },
                structuredData: { "@type": "NewsArticle", headline: "The draft headline </script>" },
            },
        };
        holding("/blog/draft-notes", ENTRY_KEY);

        const out = await html(Page({ params: params("link", ["blog", "draft-notes"]) }));

        expect(out).toContain("The draft headline");
        expect(out).not.toContain(">Draft notes<");
        const ld = [...out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
        expect(ld).toHaveLength(1);
        expect(JSON.parse(ld[0])).toEqual({ "@type": "NewsArticle", headline: "The draft headline </script>" });
    });

    it("draws the unpublished page a page link opens", async () => {
        holding("/about", PAGE_KEY);

        const out = await html(Page({ params: params("link", ["about"]) }));

        expect(out).toContain("About us, the draft");
        expect(out).toContain("A page nobody has published.");
    });

    it("is a 404 once the link is revoked or has expired, asked again on every request", async () => {
        holding("/blog/draft-notes", ENTRY_KEY);
        delete links.baryo[ENTRY_KEY];

        await expect(Page({ params: params("link", ["blog", "draft-notes"]) })).rejects.toThrow("NEXT_NOT_FOUND");
        expect(opens).toEqual([ENTRY_KEY]);
    });

    it("is a 404 for a cookie made for another path, for no cookie, and off the link gate", async () => {
        holding("/blog/draft-notes", ENTRY_KEY);
        await expect(Page({ params: params("link", ["blog", "other"]) })).rejects.toThrow("NEXT_NOT_FOUND");
        await expect(Page({ params: params("public", ["blog", "draft-notes"]) })).rejects.toThrow("NEXT_NOT_FOUND");
        requestCookies = {};
        await expect(Page({ params: params("link", ["blog", "draft-notes"]) })).rejects.toThrow("NEXT_NOT_FOUND");
        expect(opens).toEqual([]);
    });
});
