import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The page's own Content-Security-Policy: what it is built from, that a setting cannot add to it,
 * and where it sits in the head.
 */

let requestHeaders: Headers | null = null;
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
    usePathname: () => "/",
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig, EMBED_HOSTS } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { sitePolicy, cspOrigin, STATIC_POLICY } = await import("./csp.js");
const { createSiteLayout, SitePolicyMeta } = await import("./screens/site-layout.js");

const CMS = "http://cms.test";
const UMAMI_ID = "0f6a1c2e-3b4d-4e5f-8a9b-1c2d3e4f5a6b";

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    plain: { host: "plain.example", settings: { Name: "Plain", Url: "https://plain.example" } },
    video: {
        host: "video.example",
        settings: { Name: "Video", Url: "https://video.example", EmbedHosts: ["player.video.example"] },
    },
    counted: {
        host: "counted.example",
        settings: {
            Name: "Counted",
            Url: "https://counted.example",
            AnalyticsScript: "https://stats.example/script.js",
            AnalyticsWebsiteId: UMAMI_ID,
        },
    },
    held: { host: "held.example", settings: { Name: "Held", Url: "https://held.example", Mode: "Holding" } },
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

async function pageAt(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(config, { loadFonts: false });
    return render(await Layout({ children: <p>the page</p> }));
}

/** The policy in the page's meta tag, or undefined when it has none. */
function metaOf(html: string): string | undefined {
    const tag = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/);
    return tag?.[1].replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

/** One directive's values. */
function directive(policy: string, name: string): string[] | undefined {
    const found = policy.split(";").map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name);
    return found?.slice(1);
}

function names(policy: string): string[] {
    return policy.split(";").map((d) => d.trim().split(/\s+/)[0]);
}

const DIRECTIVES = ["default-src", "script-src", "style-src", "font-src", "img-src", "media-src", "connect-src", "frame-src"];

beforeEach(() => {
    forgetCachedReads();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRESS_CSP", "");
    vi.stubEnv("PRESS_SCRIPT_ORIGINS", "");
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("the policy", () => {
    it("frames the default embed hosts over https, and no directive appears twice", () => {
        const policy = sitePolicy({ embedHosts: EMBED_HOSTS });
        expect(directive(policy, "frame-src")).toEqual(EMBED_HOSTS.map((h) => `https://${h}`));
        expect(names(policy)).toEqual(DIRECTIVES);
    });

    it("keeps the directives that never depend on a site in the static header", () => {
        expect(STATIC_POLICY).toContain("object-src 'none'");
        expect(names(STATIC_POLICY)).toEqual(["object-src", "base-uri", "frame-ancestors", "form-action"]);
        const next = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
        expect(next).toContain(`const STATIC_POLICY = "${STATIC_POLICY}"`);
        expect(next).toContain("value: STATIC_POLICY");
    });

    it("frames nothing when a site allows no host", () => {
        expect(directive(sitePolicy({ embedHosts: [] }), "frame-src")).toEqual(["'none'"]);
    });

    it("gives a tenant its own embed hosts and not another tenant's", async () => {
        const video = metaOf(await pageAt("video.example"));
        const plain = metaOf(await pageAt("plain.example"));
        expect(directive(video!, "frame-src")).toEqual(["https://player.video.example"]);
        expect(plain).not.toContain("player.video.example");
        expect(directive(plain!, "frame-src")).toEqual(EMBED_HOSTS.map((h) => `https://${h}`));
    });

    it("names the analytics origin in script-src and connect-src only when the tag rendered", async () => {
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://stats.example");
        const counted = metaOf(await pageAt("counted.example"))!;
        expect(directive(counted, "script-src")).toContain("https://stats.example");
        expect(directive(counted, "connect-src")).toEqual(["'self'", "https://stats.example"]);
        expect(directive(counted, "style-src")).not.toContain("https://stats.example");

        // Another tenant has no tag, so it gets no analytics origin although the deployment allows one.
        const plain = metaOf(await pageAt("plain.example"))!;
        expect(plain).not.toContain("stats.example");

        // The tenant names the script but the deployment allows none: no tag, no origin.
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "");
        forgetCachedReads();
        const refused = metaOf(await pageAt("counted.example"))!;
        expect(refused).not.toContain("stats.example");
        expect(directive(refused, "connect-src")).toEqual(["'self'"]);
    });

    it("allows the Google font files with Google's stylesheet, and an http CMS for images and media", () => {
        const policy = sitePolicy({
            fontOrigins: ["https://fonts.googleapis.com"],
            mediaOrigins: ["http://localhost:5005", "https://cms.example"],
        });
        expect(directive(policy, "style-src")).toContain("https://fonts.googleapis.com");
        expect(directive(policy, "font-src")).toEqual(["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
        expect(directive(policy, "img-src")).toEqual(["'self'", "data:", "https:", "http://localhost:5005"]);
        expect(directive(policy, "media-src")).toEqual(["'self'", "https:", "http://localhost:5005"]);
    });

    it("puts the config's CMS origin in the media directives of a page when it is http", async () => {
        const policy = metaOf(await pageAt("plain.example"))!;
        expect(directive(policy, "img-src")).toContain("http://cms.test");
        expect(directive(policy, "media-src")).toContain("http://cms.test");
    });
});

describe("hostile values", () => {
    const HOSTILE = [
        "evil.example; script-src *",
        "evil.example 'unsafe-eval'",
        "'unsafe-eval'",
        "*",
        "*.example.com",
        "data:",
        "javascript:alert(1)",
        "https://evil.example/path",
        "https://evil.example?x=1",
        "https://user@evil.example",
        "evil .example",
        "evil.example\nscript-src *",
        'evil.example"',
        "evil.example,evil2.example",
        "",
    ];

    it("drops each one from every directive and adds no directive", () => {
        const expected = sitePolicy({ embedHosts: ["ok.example"], scriptOrigins: ["https://ok.example"], fontOrigins: ["https://ok.example"], mediaOrigins: ["http://ok.example"] });
        for (const bad of HOSTILE) {
            const policy = sitePolicy({
                embedHosts: ["ok.example", bad],
                scriptOrigins: ["https://ok.example", bad],
                fontOrigins: ["https://ok.example", bad],
                mediaOrigins: ["http://ok.example", bad],
            });
            expect(policy, JSON.stringify(bad)).toBe(expected);
            expect(names(policy)).toEqual(DIRECTIVES);
            expect(policy).not.toMatch(/unsafe-eval|\*|javascript:|\n/);
        }
    });

    it("reads a scheme and host and a port, and nothing more", () => {
        expect(cspOrigin("https://Player.Example.com:8443")).toBe("https://player.example.com:8443");
        expect(cspOrigin("http://localhost:5005")).toBeUndefined();
        expect(cspOrigin("http://localhost:5005", true)).toBe("http://localhost:5005");
        expect(cspOrigin("https://a.example:99999999")).toBeUndefined();
        expect(cspOrigin(42)).toBeUndefined();
    });

    it("cannot be turned into a directive by a tenant's embed hosts setting", async () => {
        TENANTS.video.settings.EmbedHosts = ["player.video.example; script-src *", "player.ok.example"];
        try {
            const policy = metaOf(await pageAt("video.example"))!;
            expect(policy).not.toContain("script-src *");
            expect(names(policy)).toEqual(DIRECTIVES);
            expect(directive(policy, "frame-src")).toEqual(["https://player.ok.example"]);
        } finally {
            TENANTS.video.settings.EmbedHosts = ["player.video.example"];
        }
    });

    it("is escaped as an attribute value", async () => {
        const html = await render(<head><SitePolicyMeta config={config} /></head>);
        expect(html).toContain('http-equiv="Content-Security-Policy"');
        expect(html).not.toMatch(/content="[^"]*[<>][^"]*"/);
    });
});

describe("the meta tag", () => {
    it("is the first child of head", async () => {
        const html = await pageAt("counted.example");
        expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy" content="[^"]+"\/>/);
        expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
        expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<style"));
    });

    it("is on the holding page too, with no analytics origin", async () => {
        vi.stubEnv("PRESS_SCRIPT_ORIGINS", "https://stats.example");
        const html = await pageAt("held.example");
        expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
        expect(metaOf(html)).not.toContain("stats.example");
    });

    it("is not rendered with PRESS_CSP=off", async () => {
        vi.stubEnv("PRESS_CSP", "off");
        expect(metaOf(await pageAt("plain.example"))).toBeUndefined();
        vi.stubEnv("PRESS_CSP", " OFF ");
        expect(metaOf(await pageAt("plain.example"))).toBeUndefined();
        expect(await render(<head><SitePolicyMeta config={config} /></head>)).not.toContain("Content-Security-Policy");
    });

    it("is not rendered outside production", async () => {
        vi.stubEnv("NODE_ENV", "development");
        expect(metaOf(await pageAt("plain.example"))).toBeUndefined();
    });

    it("works for a build-time site, from the config's embed hosts", async () => {
        const built = defineConfig({
            cmsUrl: CMS,
            site: { name: "Built", url: "https://built.example" },
            embedHosts: ["maps.built.example"],
        });
        const html = await render(await createSiteLayout(built, { loadFonts: false })({ children: <p>the page</p> }));
        expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
        expect(directive(metaOf(html)!, "frame-src")).toEqual(["https://maps.built.example"]);
    });
});
