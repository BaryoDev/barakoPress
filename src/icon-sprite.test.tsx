import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A tenant's icon sprite from its settings (#167): the symbols a tree's `icons` names, put on the
 * page by the engine rather than by an overlay.
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

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { applySiteSettings } = await import("./site.js");
const { createSiteLayout } = await import("./screens/site-layout.js");

const CMS = "http://cms.test";

const SEARCH = {
    viewBox: "0 0 24 24",
    paths: ["M10 4a6 6 0 1 0 0 12a6 6 0 1 0 0-12z", "M15 15l5 5"],
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth: 2,
};

const TENANTS: Record<string, { host: string; settings: Record<string, unknown> }> = {
    icons: {
        host: "icons.example",
        settings: {
            Name: "Icons",
            Url: "https://icons.example",
            IconSprite: JSON.stringify({ search: SEARCH, chevron: { viewBox: "0 0 12 12", paths: ["M2 4l4 4 4-4"] } }),
        },
    },
    none: { host: "none.example", settings: { Name: "None", Url: "https://none.example" } },
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
        if (t && url.pathname === "/api/public/site") {
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
const base = { ...config, tenant: "t" };

async function bodyAt(host: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Layout = createSiteLayout(config, { loadFonts: false });
    const errors: unknown[] = [];
    const page = await Layout({ children: <p>the page</p> });
    const { prelude } = await prerender(page, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    const html = await new Response(prelude).text();
    const body = html.indexOf("<body");
    return html.slice(html.indexOf(">", body) + 1);
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("reading IconSprite", () => {
    it("keeps each symbol that reads whole, and leaves out one with anything unreadable", () => {
        const sprite = applySiteSettings(
            base,
            {
                IconSprite: {
                    search: SEARCH,
                    plain: { viewBox: "0 0 16 16", paths: ["M0 0h16v16H0z"] },
                    "1bad-id": SEARCH,
                    "has space": SEARCH,
                    box: { viewBox: "0 0 24", paths: ["M0 0"] },
                    markup: { viewBox: "0 0 24 24", paths: ['M0 0"/><script>alert(1)</script>'] },
                    loads: { viewBox: "0 0 24 24", paths: ["M0 0"], fill: "url(https://evil.example/x.svg#p)" },
                    wide: { viewBox: "0 0 24 24", paths: ["M0 0"], strokeWidth: 400 },
                    empty: { viewBox: "0 0 24 24", paths: [] },
                    many: { viewBox: "0 0 24 24", paths: Array.from({ length: 17 }, () => "M0 0") },
                },
            },
            null,
        ).site.iconSprite;
        expect(Object.keys(sprite ?? {})).toEqual(["search", "plain"]);
        expect(sprite?.search).toEqual(SEARCH);
        expect(sprite?.plain).toEqual({ viewBox: "0 0 16 16", paths: ["M0 0h16v16H0z"] });
    });

    it("keeps the configured sprite when the setting is not an object", () => {
        const configured = { ...base, site: { ...base.site, iconSprite: { search: SEARCH } as const } };
        expect(applySiteSettings(configured, { IconSprite: ["search"] }, null).site.iconSprite).toEqual({ search: SEARCH });
    });
});

describe("the sprite on the page", () => {
    it("draws every symbol once, hidden, before the header", async () => {
        const body = await bodyAt("icons.example");
        const sprite = body.indexOf('data-press="icon-sprite"');
        expect(sprite).toBeGreaterThan(-1);
        expect(sprite).toBeLessThan(body.indexOf("<header"));
        const svg = body.match(/<svg data-press="icon-sprite"[^>]*>/)?.[0] ?? "";
        expect(svg).toContain('aria-hidden="true"');
        const symbols = [...body.matchAll(/<symbol\b[^>]*>/g)].map((m) => m[0]);
        expect(symbols).toHaveLength(2);
        expect(symbols[0]).toContain('id="search"');
        expect(symbols[0]).toContain('viewBox="0 0 24 24"');
        expect(symbols[0]).toContain('fill="none"');
        expect(symbols[0]).toContain('stroke="currentColor"');
        expect(symbols[0]).toContain('stroke-width="2"');
        expect(symbols[1]).toContain('id="chevron"');
        expect(symbols[1]).toContain('fill="currentColor"');
        expect(body).toContain('<path d="M15 15l5 5"></path>');
    });

    it("draws nothing for a site with no sprite", async () => {
        const body = await bodyAt("none.example");
        expect(body.length).toBeGreaterThan(0);
        expect(body).not.toContain("<symbol");
        expect(body).not.toContain("icon-sprite");
    });
});
