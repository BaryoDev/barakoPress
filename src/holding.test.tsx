import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
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
const { applySiteSettings, shareCookieValid, signShareCookie, siteConfig, SHARE_COOKIE } = await import("./site.js");
const { createBlogIndex } = await import("./screens/blog-index.js");
const { createSiteLayout, createSiteMetadata } = await import("./screens/site-layout.js");
const { createFeed } = await import("./routes/feed.js");
const { createSitemap } = await import("./routes/sitemap.js");
const { createRobots } = await import("./routes/robots.js");
const { createSharePage, createShareRedeemRoute } = await import("./routes/share.js");
const { createBlockRegistry } = await import("./blocks/registry.js");

const CMS = "http://cms.test";
const KEY = "share-key-for-tests-0123456789";
const SHORT_KEY = "short-share-key-for-tests-0123";
const THROTTLED = "throttled-key-for-tests-0123";
const SECRET = "a-preview-secret-for-tests-only-0123456789";
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const inAnHour = () => nowSeconds() + HOUR;

type Tenant = {
    host: string;
    settings: Record<string, unknown>;
    post: string;
    /** Share links the CMS redeems for this tenant, and the seconds each has left. */
    shareLinks?: Record<string, number>;
    pages?: Record<string, Record<string, unknown>>;
};

const TENANTS: Record<string, Tenant> = {
    soon: {
        host: "soon.example",
        settings: {
            Name: "Soon Club",
            Url: "https://soon.example",
            Mode: "Holding",
            HoldingPath: "/coming-soon",
            HeaderLinks: [
                { label: "Opening", href: "/coming-soon" },
                { label: "About", href: "/about" },
            ],
        },
        post: "launch-plans",
        shareLinks: { [KEY]: 30 * DAY, [SHORT_KEY]: HOUR },
        pages: {
            "/coming-soon": {
                id: "cs",
                slug: "coming-soon",
                data: { Title: "Opening soon", Blocks: [{ type: "richText", props: { markdown: "## Opening in October" } }] },
            },
        },
    },
    // A second holding tenant whose CMS redeems the same key, so a cookie crossing over would show.
    later: {
        host: "later.example",
        settings: { Name: "Later Club", Url: "https://later.example", Tagline: "Not yet", Mode: "Holding" },
        post: "later-plans",
        shareLinks: { [KEY]: 30 * DAY },
    },
    baryo: {
        host: "baryo.dev",
        settings: { Name: "BaryoDev", Url: "https://baryo.dev", Mode: "Live" },
        post: "shipping-notes",
    },
};

type Call = { method: string; path: string; tenant: string | null; body?: string };
let calls: Call[] = [];
/** The headers each redemption reached the CMS with. */
let redeemHeaders: Headers[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        const method = init?.method ?? "GET";
        calls.push({ method, path: url.pathname + url.search, tenant, body: typeof init?.body === "string" ? init.body : undefined });

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        if (method === "POST" && url.pathname === "/api/public/site/share-links/redeem") {
            redeemHeaders.push(new Headers(init?.headers));
            const key = JSON.parse(String(init?.body)).key;
            if (key === THROTTLED) return new Response("", { status: 429 });
            const left = t.shareLinks?.[key];
            return left
                ? Response.json({ expiresAt: new Date(Date.now() + left * 1000).toISOString() })
                : new Response("", { status: 404 });
        }
        const page = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") return page([{ id: "s", data: t.settings }]);
        if (url.pathname === "/api/public/post")
            return page([{ id: t.post, slug: t.post, data: { Title: `${t.settings.Name} post`, Slug: t.post, Body: "x" } }]);
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "/";
            const entry = t.pages?.[path];
            return entry
                ? Response.json({ contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });
const registry = createBlockRegistry(config);

/** A visitor: the host they asked for, and the share session cookie if they have one. */
function visit(host: string, cookie?: string) {
    requestHeaders = new Headers({ host });
    requestCookies = cookie === undefined ? {} : { [SHARE_COOKIE]: cookie };
}

async function layoutHtml(render: (node: ReactNode) => Promise<string> | string = renderToStaticMarkup): Promise<string> {
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
    return render(await Layout({ children }));
}

/** A render that waits on async components, as a block like the collection is. A render error is thrown, not streamed past. */
async function asyncRender(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    requestCookies = null;
    calls = [];
    redeemHeaders = [];
    vi.stubGlobal("fetch", cms());
    vi.stubEnv("PRESS_PREVIEW_SECRET", SECRET);
    vi.stubEnv("PRESS_SECRET", undefined);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("reading the site mode from the settings", () => {
    const base = { ...config, tenant: "t" };

    it("is live when Mode is unset, Live or anything it does not know", () => {
        for (const d of [undefined, { Name: "X" }, { Mode: "Live" }, { Mode: "live", HoldingPath: "/soon" }, { Mode: "Private" }, { Mode: true }]) {
            expect(applySiteSettings(base, d, null).holding).toBeUndefined();
        }
    });

    it("ignores the ComingSoon fields of the earlier design", () => {
        expect(applySiteSettings(base, { ComingSoon: true, ComingSoonPath: "/soon", PreviewKeyHash: "ab" }, null).holding).toBeUndefined();
    });

    it("holds on Mode Holding, in any case, with the HoldingPath", () => {
        expect(applySiteSettings(base, { Mode: "Holding", HoldingPath: "/coming-soon" }, null).holding).toEqual({ path: "/coming-soon" });
        expect(applySiteSettings(base, { Mode: " holding ", HoldingPath: "/soon" }, null).holding).toEqual({ path: "/soon" });
        expect(applySiteSettings(base, { Mode: "Holding", HoldingPath: "" }, null).holding).toEqual({});
        expect(applySiteSettings(base, { Mode: "Holding" }, null).holding).toEqual({});
    });

    it("drops a HoldingPath that is not a plain site path, which leaves the default holding page", () => {
        for (const path of ["coming-soon", "//evil.example/x", "https://evil.example/", "/a b", "/a?b=1", "/a\\b"]) {
            expect(applySiteSettings(base, { Mode: "Holding", HoldingPath: path }, null).holding).toEqual({});
        }
    });

    it("takes a link to the holding page out of the header, top bar and footer while holding, and only then", () => {
        const links = [
            { label: "Opening", href: "/Coming-Soon/" },
            { label: "Absolute", href: "https://soon.example/coming-soon" },
            { label: "Elsewhere", href: "https://other.example/coming-soon" },
            { label: "About", href: "/about" },
        ];
        const settings = {
            Url: "https://soon.example",
            HeaderLinks: links,
            TopBar: { text: "hi", links },
            FooterColumns: [{ heading: "Club", links }],
            HoldingPath: "/coming-soon",
        };
        const held = applySiteSettings(base, { ...settings, Mode: "Holding" }, null).site;
        const kept = ["Elsewhere", "About"];
        expect(held.headerLinks!.map((l) => l.label)).toEqual(kept);
        expect(held.topBar!.links.map((l) => l.label)).toEqual(kept);
        expect(held.footerColumns![0].links.map((l) => l.label)).toEqual(kept);

        const live = applySiteSettings(base, { ...settings, Mode: "Live" }, null).site;
        expect(live.headerLinks).toHaveLength(4);
    });
});

describe("the signed share session cookie", () => {
    it("is valid for the tenant and secret it was signed with, until it expires", () => {
        const exp = inAnHour();
        const value = signShareCookie("soon", exp, SECRET);
        expect(value).not.toContain(KEY);
        expect(shareCookieValid(value, "soon", SECRET)).toBe(true);
        expect(shareCookieValid(value, "soon", SECRET, (exp - 1) * 1000)).toBe(true);
        expect(shareCookieValid(value, "soon", SECRET, exp * 1000)).toBe(false);
    });

    it("is ignored when forged, expired, tampered with, for another tenant, past the 24 hour cap, or with no secret", () => {
        const exp = inAnHour();
        const good = signShareCookie("soon", exp, SECRET);
        const past = nowSeconds() - 60;
        const [, sig] = good.split(".");

        expect(shareCookieValid(good, "soon", SECRET)).toBe(true);
        expect(shareCookieValid(signShareCookie("soon", exp, `${SECRET}x`), "soon", SECRET)).toBe(false);
        expect(shareCookieValid(signShareCookie("soon", past, SECRET), "soon", SECRET)).toBe(false);
        expect(shareCookieValid(`${exp + HOUR}.${sig}`, "soon", SECRET)).toBe(false);
        expect(shareCookieValid(good, "later", SECRET)).toBe(false);
        expect(shareCookieValid(good, "soon", null)).toBe(false);
        expect(shareCookieValid(signShareCookie("soon", nowSeconds() + 2 * DAY, SECRET), "soon", SECRET)).toBe(false);
        for (const junk of ["", KEY, `${exp}`, `${exp}.`, `x.${sig}`, `${exp}.${sig}x`]) {
            expect(shareCookieValid(junk, "soon", SECRET)).toBe(false);
        }
    });
});

describe("a tenant in holding mode", () => {
    it("holds back every page from a visitor without a session or with a bad cookie, and shows it to a signed one", async () => {
        visit("soon.example");
        await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");

        const past = nowSeconds() - 60;
        for (const bad of [KEY, signShareCookie("soon", past, SECRET), signShareCookie("soon", inAnHour(), "another-secret-that-is-long-enough-000000")]) {
            visit("soon.example", bad);
            await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");
        }

        visit("soon.example", signShareCookie("soon", inAnHour(), SECRET));
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "soon" });
    });

    it("lets nobody through when PRESS_PREVIEW_SECRET is unset or short, even with a cookie signed with it", async () => {
        const cookie = signShareCookie("soon", inAnHour(), SECRET);
        for (const secret of ["", "short"]) {
            vi.stubEnv("PRESS_PREVIEW_SECRET", secret);
            visit("soon.example", cookie);
            await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");
        }
    });

    it("renders the page at HoldingPath as the holding page, with none of the site in it", async () => {
        visit("soon.example");
        const html = await layoutHtml();

        expect(html).toContain('data-press="holding"');
        expect(html).toContain("Opening in October");
        expect(html).toContain("Opening soon");
        expect(html).not.toContain("launch-plans");
        expect(html).not.toContain("Soon Club post");
        expect(html).not.toContain("not found fallback");
        expect(html).not.toContain("/feed.xml");
        const resolves = calls.filter((c) => c.path.startsWith("/api/public/pages/resolve"));
        expect(resolves).toEqual([{ method: "GET", path: "/api/public/pages/resolve?path=%2Fcoming-soon", tenant: "soon", body: undefined }]);
    });

    it("carries the not valid notice, hidden unless the address ends in #share-invalid", async () => {
        visit("soon.example");
        const html = await layoutHtml();
        expect(html).toContain('id="share-invalid"');
        expect(html).toContain("This link is not valid or has expired.");
        expect(html).toContain("#share-invalid{display:none}#share-invalid:target{display:block}");
    });

    it("renders a holding page that contains a collection block, with none of the collection in it", async () => {
        const page = TENANTS.soon.pages!["/coming-soon"];
        const saved = page.data;
        page.data = {
            Title: "Opening soon",
            Blocks: [
                { type: "richText", props: { markdown: "## Opening in October" } },
                { type: "collection", props: { collection: "post", heading: "Latest from the club" } },
            ],
        };
        try {
            visit("soon.example");
            const html = await layoutHtml(asyncRender);

            expect(html).toContain('data-press="holding"');
            expect(html).toContain("Opening in October");
            expect(html).not.toContain("not found fallback");
            expect(html).not.toContain("Latest from the club");
            expect(html).not.toContain("Soon Club post");
            expect(html).not.toContain("launch-plans");
        } finally {
            page.data = saved;
        }
    });

    it("renders the default holding page from the theme when HoldingPath is empty, without asking for a page", async () => {
        visit("later.example");
        const html = await layoutHtml();
        expect(html).toContain('data-press="holding"');
        expect(html).toContain("Later Club");
        expect(html).toContain("Not yet");
        expect(html).toContain("Coming soon.");
        expect(html).not.toContain("later-plans");
        expect(calls.some((c) => c.path.startsWith("/api/public/pages/resolve"))).toBe(false);
    });

    it("falls back to the default holding page when HoldingPath does not resolve", async () => {
        const saved = TENANTS.soon.settings.HoldingPath;
        TENANTS.soon.settings.HoldingPath = "/no-such-page";
        try {
            visit("soon.example");
            const html = await layoutHtml();
            expect(calls.some((c) => c.path === "/api/public/pages/resolve?path=%2Fno-such-page")).toBe(true);
            expect(html).toContain('data-press="holding"');
            expect(html).toContain("Soon Club");
            expect(html).toContain("Coming soon.");
            expect(html).not.toContain("Opening in October");
            expect(html).not.toContain("launch-plans");
        } finally {
            TENANTS.soon.settings.HoldingPath = saved;
        }
    });

    it("keeps the holding page out of the navigation a visitor with a session sees", async () => {
        visit("soon.example", signShareCookie("soon", inAnHour(), SECRET));
        const html = await layoutHtml();
        expect(html).toContain("launch-plans");
        expect(html).toContain('href="/about"');
        expect(html).not.toContain('href="/coming-soon"');
    });

    it("never hands a visitor without a session the render made for one with it, or the reverse", async () => {
        const signed = signShareCookie("soon", inAnHour(), SECRET);
        const seen: string[] = [];
        for (const cookie of [signed, undefined, signed, undefined, KEY, signed]) {
            visit("soon.example", cookie);
            const html = await layoutHtml();
            const held = html.includes('data-press="holding"');
            const real = html.includes("launch-plans");
            expect(held).not.toBe(real);
            seen.push(held ? "held" : "real");
        }
        expect(seen).toEqual(["real", "held", "real", "held", "held", "real"]);
    });

    it("marks the site noindex and drops the feed link, session or not", async () => {
        for (const cookie of [undefined, signShareCookie("soon", inAnHour(), SECRET)]) {
            visit("soon.example", cookie);
            const meta = await createSiteMetadata(config)();
            expect(meta.robots).toEqual({ index: false, follow: false });
            expect(meta.alternates).toBeUndefined();
        }
    });

    it("serves no feed or sitemap, session or not, and a robots that disallows everything", async () => {
        for (const cookie of [undefined, signShareCookie("soon", inAnHour(), SECRET)]) {
            visit("soon.example", cookie);
            expect((await createFeed(config)()).status).toBe(404);
            await expect(createSitemap(config)()).rejects.toThrow("NEXT_NOT_FOUND");
            const robots = await createRobots(config)();
            expect(robots.rules).toEqual({ userAgent: "*", disallow: "/" });
            expect(robots.sitemap).toBeUndefined();
        }
    });
});

describe("two tenants on the same container", () => {
    it("a cookie signed for one holding tenant does not open another", async () => {
        const forSoon = signShareCookie("soon", inAnHour(), SECRET);
        visit("later.example", forSoon);
        await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");
        visit("soon.example", forSoon);
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "soon" });
    });

    it("a live tenant is unaffected, and its requests never read the cookie", async () => {
        // Warm the holding tenant first, in the same process, so anything shared would show.
        visit("soon.example");
        await layoutHtml();

        requestHeaders = new Headers({ host: "baryo.dev" });
        requestCookies = null;
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "baryo" });
        const html = await layoutHtml();
        expect(html).toContain("shipping-notes");
        expect(html).not.toContain('data-press="holding"');
        expect(html).not.toContain('id="share-invalid"');
        expect(html).toContain("/feed.xml");

        const feed = await createFeed(config)();
        expect(feed.status).toBe(200);
        expect(await feed.text()).toContain("https://baryo.dev/blog/shipping-notes");
        expect((await createRobots(config)()).sitemap).toBe("https://baryo.dev/sitemap.xml");
        expect((await createSiteMetadata(config)()).robots).toBeUndefined();
    });
});

describe("redeeming a share link", () => {
    const POST = createShareRedeemRoute(config);
    type Ask = { query?: string; body?: string; type?: string; headers?: Record<string, string> };
    const ask = (host: string, { query = "", body, type = "application/x-www-form-urlencoded", headers = {} }: Ask) =>
        POST(
            new Request(`http://internal:3000/api/share/redeem${query}`, {
                method: "POST",
                headers: { host, "content-type": type, ...headers },
                body,
            }),
        );
    const form = (key: string) => new URLSearchParams({ key }).toString();
    const redeems = () => calls.filter((c) => c.path === "/api/public/site/share-links/redeem");
    const cookieValue = (res: Response) => {
        const cookie = res.headers.get("set-cookie") ?? "";
        return cookie.slice(SHARE_COOKIE.length + 1, cookie.indexOf(";"));
    };

    it("asks the CMS once, and on 200 sets a signed host-only cookie capped at 24 hours and redirects to /", async () => {
        const before = nowSeconds();
        const res = await ask("soon.example", { body: form(KEY) });

        expect(redeems()).toEqual([{ method: "POST", path: "/api/public/site/share-links/redeem", tenant: "soon", body: JSON.stringify({ key: KEY }) }]);
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(res.headers.get("cache-control")).toBe("no-store");
        const cookie = res.headers.get("set-cookie") ?? "";
        expect(cookie.startsWith(`${SHARE_COOKIE}=`)).toBe(true);
        for (const part of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(cookie).toContain(`; ${part}`);
        expect(cookie.toLowerCase()).not.toContain("domain=");
        expect(cookie).not.toContain(KEY);

        const value = cookieValue(res);
        expect(shareCookieValid(value, "soon", SECRET)).toBe(true);
        expect(shareCookieValid(value, "later", SECRET)).toBe(false);
        // The link has 30 days left, so the session is the 24 hour cap.
        const expires = Number(value.split(".")[0]);
        expect(expires).toBeGreaterThanOrEqual(before + DAY);
        expect(expires).toBeLessThanOrEqual(before + DAY + 5);
        const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
        expect(maxAge).toBeGreaterThan(DAY - 5);
        expect(maxAge).toBeLessThanOrEqual(DAY);
    });

    it("ends the session when the link expires, if that is sooner than 24 hours", async () => {
        const before = nowSeconds();
        const res = await ask("soon.example", { body: form(SHORT_KEY) });
        const expires = Number(cookieValue(res).split(".")[0]);
        expect(expires).toBeGreaterThanOrEqual(before + HOUR - 1);
        expect(expires).toBeLessThanOrEqual(before + HOUR + 5);
        expect(Number(/Max-Age=(\d+)/.exec(res.headers.get("set-cookie") ?? "")?.[1])).toBeLessThanOrEqual(HOUR);
    });

    it("takes the key as JSON too", async () => {
        const res = await ask("soon.example", { body: JSON.stringify({ key: KEY }), type: "application/json" });
        expect(shareCookieValid(cookieValue(res), "soon", SECRET)).toBe(true);
    });

    it("sets nothing on a 404 or a 429, and lands on the holding page with the notice", async () => {
        for (const key of ["wrong-key-but-long-enough-000", THROTTLED]) {
            calls = [];
            const res = await ask("soon.example", { body: form(key) });
            expect(redeems()).toHaveLength(1);
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/#share-invalid");
            expect(res.headers.get("cache-control")).toBe("no-store");
            expect(res.headers.get("set-cookie")).toBeNull();
        }
    });

    it("sets nothing when the CMS fails, cannot be reached, or answers 200 without a usable expiry", async () => {
        const failures = [
            async () => new Response("", { status: 500 }),
            async () => {
                throw new Error("ECONNREFUSED");
            },
            async () => Response.json({}),
            async () => Response.json({ expiresAt: "not a time" }),
            async () => Response.json({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
        ];
        for (const failure of failures) {
            const inner = cms();
            vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
                String(input).endsWith("/api/public/site/share-links/redeem") ? failure() : inner(input, init),
            ));
            const res = await ask("soon.example", { body: form(KEY) });
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/#share-invalid");
            expect(res.headers.get("set-cookie")).toBeNull();
        }
    });

    it("never reads the key from the query string", async () => {
        for (const body of [undefined, "", form("")]) {
            const res = await ask("soon.example", { query: `?key=${KEY}`, body });
            expect(res.headers.get("set-cookie")).toBeNull();
            expect(res.headers.get("location")).toBe("/#share-invalid");
        }
        expect(redeems()).toHaveLength(0);
    });

    it("does not ask the CMS for an empty, malformed or oversized key, or with no secret configured", async () => {
        for (const body of ["", form(""), form("short"), form("a".repeat(600)), "key", `key=${"a".repeat(5000)}`]) {
            const res = await ask("soon.example", { body });
            expect(res.status).toBe(303);
            expect(res.headers.get("set-cookie")).toBeNull();
        }
        const text = await ask("soon.example", { body: form(KEY), type: "text/plain" });
        expect(text.headers.get("set-cookie")).toBeNull();
        vi.stubEnv("PRESS_PREVIEW_SECRET", "");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = await ask("soon.example", { body: form(KEY) });
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(redeems()).toHaveLength(0);
    });

    const RENDERER_KEY = "renderer-key-for-tests-0123456789abcdef";
    const behindProxy = createShareRedeemRoute({ ...config, sites: { ...config.sites!, visitorIpHeader: "X-Real-IP" } });
    const askBehindProxy = (headers: HeadersInit) => {
        const sent = new Headers(headers);
        sent.set("host", "soon.example");
        sent.set("content-type", "application/x-www-form-urlencoded");
        return behindProxy(new Request("http://internal:3000/api/share/redeem", { method: "POST", headers: sent, body: form(KEY) }));
    };

    it("sends the renderer key and the visitor's IP when both are known", async () => {
        vi.stubEnv("CMS_RENDERER_KEY", RENDERER_KEY);
        for (const ip of ["203.0.113.7", "2001:db8::1"]) {
            redeemHeaders = [];
            const res = await askBehindProxy({ "x-real-ip": ip });
            expect(res.headers.get("location")).toBe("/");
            expect(redeemHeaders).toHaveLength(1);
            expect(redeemHeaders[0].get("x-barako-renderer-key")).toBe(RENDERER_KEY);
            expect(redeemHeaders[0].get("x-barako-visitor-ip")).toBe(ip);
        }
    });

    it("sends no renderer key when CMS_RENDERER_KEY is unset", async () => {
        vi.stubEnv("CMS_RENDERER_KEY", undefined);
        await askBehindProxy({ "x-real-ip": "203.0.113.7" });
        vi.stubEnv("CMS_RENDERER_KEY", "   ");
        await askBehindProxy({ "x-real-ip": "203.0.113.7" });
        expect(redeemHeaders).toHaveLength(2);
        for (const sent of redeemHeaders) {
            expect(sent.has("x-barako-renderer-key")).toBe(false);
            expect(sent.get("x-barako-visitor-ip")).toBe("203.0.113.7");
        }
    });

    it("sends no visitor IP for a value that is not exactly one address, or when no header is named", async () => {
        vi.stubEnv("CMS_RENDERER_KEY", RENDERER_KEY);
        const twice = new Headers();
        twice.append("x-real-ip", "203.0.113.7");
        twice.append("x-real-ip", "198.51.100.2");
        const refusedValues: HeadersInit[] = [
            twice,
            { "x-real-ip": "203.0.113.7, 198.51.100.2" },
            { "x-real-ip": "not-an-address" },
            { "x-real-ip": "203.0.113.7:443" },
            { "x-real-ip": "[2001:db8::1]" },
            { "x-real-ip": "fe80::1%eth0" },
            { "x-real-ip": "" },
            {},
        ];
        for (const headers of refusedValues) await askBehindProxy(headers);
        // With no header named, a forwarded value a caller sent is not trusted either.
        await ask("soon.example", { body: form(KEY), headers: { "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.7" } });

        expect(redeemHeaders).toHaveLength(refusedValues.length + 1);
        for (const sent of redeemHeaders) {
            expect(sent.has("x-barako-visitor-ip")).toBe(false);
            expect(sent.get("x-barako-renderer-key")).toBe(RENDERER_KEY);
        }
    });

    it("never logs the renderer key", async () => {
        vi.stubEnv("CMS_RENDERER_KEY", RENDERER_KEY);
        const logged: unknown[][] = [];
        for (const level of ["log", "info", "warn", "error", "debug"] as const) {
            vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
        }
        await askBehindProxy({ "x-real-ip": "203.0.113.7" });
        await ask("soon.example", { body: form("wrong-key-but-long-enough-000") });
        const inner = cms();
        vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).endsWith("/api/public/site/share-links/redeem")) throw new Error("ECONNREFUSED");
            return inner(input, init);
        }));
        await askBehindProxy({ "x-real-ip": "203.0.113.7" });
        vi.stubEnv("PRESS_PREVIEW_SECRET", "");
        await askBehindProxy({ "x-real-ip": "203.0.113.7" });

        expect(redeemHeaders.length).toBeGreaterThan(0);
        expect(logged.length).toBeGreaterThan(0);
        for (const args of logged) {
            expect(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" ")).not.toContain(RENDERER_KEY);
        }
    });

    it("refuses a post from another site", async () => {
        const crossSite: Record<string, string>[] = [
            { origin: "https://evil.example" },
            { origin: "null" },
            { "sec-fetch-site": "cross-site" },
            { "sec-fetch-site": "same-site", origin: "https://soon.example" },
        ];
        for (const headers of crossSite) {
            const res = await ask("soon.example", { body: form(KEY), headers });
            expect(res.headers.get("set-cookie")).toBeNull();
        }
        expect(redeems()).toHaveLength(0);
        const same = await ask("soon.example", { body: form(KEY), headers: { origin: "https://soon.example", "sec-fetch-site": "same-origin" } });
        expect(shareCookieValid(cookieValue(same), "soon", SECRET)).toBe(true);
    });

    it("gives a live tenant no cookie and does not ask, and an unknown host a 404", async () => {
        const res = await ask("baryo.dev", { body: form(KEY) });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(redeems()).toHaveLength(0);
        expect((await ask("unknown.example", { body: form(KEY) })).status).toBe(404);
    });

    it("never logs the key", async () => {
        const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
            vi.spyOn(console, m).mockImplementation(() => {}),
        );
        await ask("soon.example", { body: form(KEY) });
        await ask("soon.example", { body: form("wrong-key-but-long-enough-000") });
        await ask("soon.example", { body: form(THROTTLED) });
        vi.stubEnv("PRESS_PREVIEW_SECRET", "");
        await ask("soon.example", { body: form(KEY) });
        visit("soon.example", KEY);
        await layoutHtml();
        const logged = spies.flatMap((spy) => spy.mock.calls);
        expect(logged.length).toBeGreaterThan(0);
        for (const args of logged) expect(JSON.stringify(args)).not.toContain(KEY);
    });
});

describe("one PRESS_SECRET for share sessions", () => {
    const OTHER = "a-press-secret-for-tests-only-abcdefghijk";
    const redeem = () =>
        createShareRedeemRoute(config)(
            new Request("http://internal:3000/api/share/redeem", {
                method: "POST",
                headers: { host: "soon.example", "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ key: KEY }).toString(),
            }),
        );
    const cookieOf = (res: Response) => {
        const cookie = res.headers.get("set-cookie") ?? "";
        return cookie.slice(SHARE_COOKIE.length + 1, cookie.indexOf(";"));
    };

    it("issues and honours a session with only PRESS_SECRET set", async () => {
        vi.stubEnv("PRESS_PREVIEW_SECRET", undefined);
        vi.stubEnv("PRESS_SECRET", OTHER);

        const res = await redeem();
        expect(res.headers.get("location")).toBe("/");
        const value = cookieOf(res);
        expect(shareCookieValid(value, "soon", OTHER)).toBe(true);

        visit("soon.example", value);
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "soon" });
    });

    it("takes PRESS_SECRET over PRESS_PREVIEW_SECRET when both are set", async () => {
        vi.stubEnv("PRESS_PREVIEW_SECRET", SECRET);
        vi.stubEnv("PRESS_SECRET", OTHER);

        visit("soon.example", signShareCookie("soon", inAnHour(), SECRET));
        await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");
        visit("soon.example", signShareCookie("soon", inAnHour(), OTHER));
        await expect(siteConfig(config)).resolves.toMatchObject({ tenant: "soon" });
    });

    it("opens nothing with a PRESS_SECRET shorter than 32 characters, whatever PRESS_PREVIEW_SECRET holds", async () => {
        vi.stubEnv("PRESS_PREVIEW_SECRET", SECRET);
        vi.stubEnv("PRESS_SECRET", "short-press-secret");
        vi.spyOn(console, "warn").mockImplementation(() => {});

        for (const signedWith of [SECRET, "short-press-secret"]) {
            visit("soon.example", signShareCookie("soon", inAnHour(), signedWith));
            await expect(siteConfig(config)).rejects.toThrow("NEXT_NOT_FOUND");
        }
        expect((await redeem()).headers.get("set-cookie")).toBeNull();
    });

    it("signs the cookie byte for byte as before", () => {
        // openssl dgst -sha256 -hmac SECRET -binary over "press-share.soon.2000000000", base64url.
        expect(signShareCookie("soon", 2_000_000_000, SECRET)).toBe("2000000000.y3IurHO0YKCEWZ3DaZzy6gQK5BA_ITMK4Q1IaetVWlI");
    });
});

describe("the /_share page", () => {
    it("moves the fragment into a form post, drops it from history, and explains itself without JavaScript", async () => {
        const res = await createSharePage()();
        const html = await res.text();
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(html).toContain("location.hash");
        expect(html).toContain('history.replaceState(null, "", location.pathname)');
        expect(html).toContain('form.action = "/api/share/redeem"');
        expect(html).toContain('method="post"');
        expect(html).toMatch(/<noscript><p>[^<]*needs JavaScript[^<]*<\/p><\/noscript>/);
        expect(html).toContain('name="robots" content="noindex, nofollow"');
    });

    it("posts to the redeem route where it is mounted, escaped into the script", async () => {
        const html = await (await createSharePage({ redeemPath: "/x/</script>" })()).text();
        expect(html).toContain('form.action = "/x/\\u003c/script>"');
        expect(html.match(/<\/script>/g)).toHaveLength(1);
    });
});
