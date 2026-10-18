import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { createSiteLayout } = await import("./screens/site-layout.js");
const { withoutHeaderDuplicates } = await import("./screens/header-links.js");

const config = defineConfig({ sites: {}, cmsUrl: "http://cms.test", pages: "" });
const item = (path: string, title: string, children: any[] = []) => ({ id: path, title, slug: path.slice(1), path, children });

const TENANT = {
    host: "dup.example",
    settings: { Name: "Dup", Url: "https://dup.example", HeaderLinks: [{ label: "About", href: "/about" }] },
    navigation: { contract: 2, items: [item("/about", "About"), item("/find", "Find")] },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.startsWith("/api/tenants/by-host/")) return Response.json({ handle: "dup" });
        if (new Headers(init?.headers).get("x-tenant") !== "dup") return new Response("", { status: 404 });
        const list = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        switch (url.pathname) {
            case "/api/public/site":
                return list([{ id: "s", data: TENANT.settings }]);
            case "/api/public/post":
                return list([]);
            case "/api/public/pages/navigation":
                return Response.json(TENANT.navigation);
        }
        return new Response("", { status: 404 });
    });
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = new Headers({ host: TENANT.host });
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("withoutHeaderDuplicates", () => {
    it("drops a page the header already links to", () => {
        const out = withoutHeaderDuplicates(config, [item("/about", "About"), item("/find", "Find")], [{ label: "About", href: "/about" }]);
        expect(out.map((i) => i.path)).toEqual(["/find"]);
    });

    it("matches a trailing slash and a different case", () => {
        const out = withoutHeaderDuplicates(config, [item("/About", "About")], [{ label: "About", href: "/about/" }]);
        expect(out).toEqual([]);
    });

    it("keeps a page whose children would otherwise vanish", () => {
        const parent = item("/about", "About", [item("/about/team", "Team")]);
        const out = withoutHeaderDuplicates(config, [parent], [{ label: "About", href: "/about" }]);
        expect(out).toHaveLength(1);
    });

    const site = defineConfig({ sites: {}, cmsUrl: "http://cms.test", pages: "", site: { name: "Dup", url: "https://dup.example" } });

    it.each([
        ["an absolute same-site link", "https://dup.example/about"],
        ["a link with a query", "/about?ref=nav"],
        ["a link with a hash", "/about#top"],
        ["an absolute link with a query and hash", "https://dup.example/about/?a=1#b"],
    ])("matches %s", (_name, href) => {
        const out = withoutHeaderDuplicates(site, [item("/about", "About"), item("/find", "Find")], [{ label: "About", href }]);
        expect(out.map((i) => i.path)).toEqual(["/find"]);
    });

    it("drops a child page the header links to and keeps its parent", () => {
        const parent = item("/about", "About", [item("/about/team", "Team"), item("/about/history", "History")]);
        const out = withoutHeaderDuplicates(site, [parent], [{ label: "Team", href: "https://dup.example/about/team#x" }]);
        expect(out).toHaveLength(1);
        expect(out[0].children.map((c) => c.path)).toEqual(["/about/history"]);
    });

    it("compares against the page under a non-empty mount", () => {
        const mounted = defineConfig({ sites: {}, cmsUrl: "http://cms.test", pages: "/docs", site: { name: "Dup", url: "https://dup.example" } });
        const items = [item("/about", "About"), item("/find", "Find")];
        const out = withoutHeaderDuplicates(mounted, items, [{ label: "About", href: "https://dup.example/docs/about?x=1" }]);
        expect(out.map((i) => i.path)).toEqual(["/find"]);
        const bare = withoutHeaderDuplicates(mounted, items, [{ label: "About", href: "/about" }]);
        expect(bare).toHaveLength(2);
    });

    it("leaves a link to another site alone", () => {
        const out = withoutHeaderDuplicates(site, [item("/about", "About")], [{ label: "About", href: "https://example.org/about" }]);
        expect(out).toHaveLength(1);
    });

    it("leaves an external link alone", () => {
        const out = withoutHeaderDuplicates(config, [item("/about", "About")], [{ label: "About", href: "https://example.org/about" }]);
        expect(out).toHaveLength(1);
    });
});

describe("the real header", () => {
    it("draws a page once under a non-empty mount", async () => {
        const mounted = defineConfig({ sites: {}, cmsUrl: "http://cms.test", pages: "/docs" });
        TENANT.settings.HeaderLinks = [{ label: "About", href: "/docs/about" }];
        try {
            const Layout = createSiteLayout(mounted, { loadFonts: false });
            const html = renderToStaticMarkup(await Layout({ children: <p>child</p> }));
            expect([...html.matchAll(/<a\b[^>]*>\s*About\s*<\/a>/g)]).toHaveLength(1);
            expect(html).toContain('href="/docs/find"');
        } finally {
            TENANT.settings.HeaderLinks = [{ label: "About", href: "/about" }];
        }
    });

    it("draws About once when the header links it and the page tree lists it", async () => {
        const Layout = createSiteLayout(config, { loadFonts: false });
        const html = renderToStaticMarkup(await Layout({ children: <p>child</p> }));
        const about = [...html.matchAll(/<a\b[^>]*>\s*About\s*<\/a>/g)];
        expect(about).toHaveLength(1);
        expect(html).toContain("Find");
    });
});
