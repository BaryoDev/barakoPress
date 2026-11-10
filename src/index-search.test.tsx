import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The search block on a collection's index page (#251): the query binds there, hits and the in-page
 * index group under the product labels, and a group with nothing left says so.
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
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
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
const { createCollectionIndex } = await import("./screens/collection.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const DOCS: Entry[] = [
    { id: "d1", slug: "quickstart", data: { Title: "Quickstart", Slug: "quickstart", Body: "Start.", Section: "Start", Product: "cms" } },
    { id: "d2", slug: "delivery-api", data: { Title: "Public delivery API", Slug: "delivery-api", Body: "Read.", Section: "Start", Product: "cms" } },
    { id: "d3", slug: "press-quickstart", data: { Title: "Rendering with the press", Slug: "press-quickstart", Body: "Install.", Section: "Start", Product: "press" } },
];
const GUIDES: Entry[] = [
    { id: "g1", slug: "one", data: { Title: "Guide one", Slug: "one", Body: "One.", Section: "Start" } },
    { id: "g2", slug: "two", data: { Title: "Guide two", Slug: "two", Body: "Two.", Section: "Start" } },
];

const DOCS_COLLECTION = {
    type: "doc",
    route: "/docs",
    label: "Documentation",
    indexPage: "/landing",
    fields: { title: "Title", slug: "Slug", body: "Body" },
    tree: {
        section: "Section",
        product: "Product",
        products: [
            { key: "cms", label: "Alpha product", href: "/docs" },
            { key: "press", label: "Beta product", href: "/docs/press" },
        ],
    },
};
const GUIDES_COLLECTION = {
    type: "guide",
    route: "/guides",
    label: "Guides",
    indexPage: "/guide-landing",
    fields: { title: "Title", slug: "Slug", body: "Body" },
    tree: { section: "Section" },
};

let landing: Record<string, unknown>[] = [];

function pageOf(slug: string, blocks: Record<string, unknown>[]) {
    return { id: slug, slug, data: { Title: slug, Slug: slug, Blocks: blocks } };
}

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        if (url.pathname === "/api/tenants/by-host/site.example") return Response.json({ handle: "t" });
        if (tenant !== "t") return new Response("", { status: 404 });
        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 100, totalItems: items.length, totalPages: 1, hasNextPage: false });

        if (url.pathname === "/api/public/site") {
            return paged([{ id: "s", data: { Name: "Site", Url: "https://site.example", Collections: { docs: DOCS_COLLECTION, guides: GUIDES_COLLECTION } } }]);
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path");
            const found = path === "/landing" ? pageOf("landing", landing) : path === "/guide-landing" ? pageOf("guide-landing", landing) : undefined;
            return found ? Response.json({ contract: 2, path: `/${found.slug}`, entry: found, breadcrumbs: [] }) : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 2, items: [] });
        if (url.pathname.startsWith("/api/public/redirects/")) return new Response("", { status: 404 });

        const [type, rest] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        const rows = type === "doc" ? DOCS : type === "guide" ? GUIDES : undefined;
        if (!rows) return new Response("", { status: 404 });
        if (rest === "search") {
            const q = (url.searchParams.get("q") ?? "").toLowerCase();
            const results = rows.filter((d) => String(d.data.Title).toLowerCase().includes(q));
            return Response.json({ results, count: results.length, query: q });
        }
        return paged(rows);
    });
}

const base = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

async function draw(collection: string, q?: string): Promise<string> {
    requestHeaders = new Headers({ host: "site.example" });
    const Index = createCollectionIndex(base, collection, { search: true });
    const stream = await renderToReadableStream(await Index({ searchParams: Promise.resolve(q === undefined ? {} : { q }) }));
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** What the search block drew: the index page's lead, not the sidebar, tabs or list beside it. */
function lead(html: string): string {
    const from = html.indexOf('data-block="search"');
    const end = html.indexOf('class="shell"', from);
    return from < 0 ? "" : html.slice(from, end < 0 ? undefined : end);
}

/** Whether a group's "No match here" line is showing. */
function shown(group: string): boolean {
    const tag = group.match(/<p[^>]*data-bp-search-group-empty[^>]*>/)?.[0];
    return tag !== undefined && !tag.includes("hidden");
}

/** One product group: from its label to the next group or the end of the block. */
function group(html: string, label: string): string {
    const from = html.indexOf(label);
    if (from < 0) return "";
    const next = html.indexOf("data-bp-search-group=", from + label.length);
    return html.slice(from, next < 0 ? undefined : next);
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.stubGlobal("fetch", cms());
    landing = [{ type: "search", props: { collection: "docs", query: "{{query.q}}", groupBy: "product" } }];
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the search block on a collection index page", () => {
    it("binds the query the index was asked for", async () => {
        const html = await draw("docs", "delivery");
        const input = html.match(/<input[^>]*id="bp-search-block-docs"[^>]*>/)?.[0] ?? "";
        expect(input).toContain('value="delivery"');
    });

    it("draws the index page with no query when the box is empty", async () => {
        const html = await draw("docs");
        expect(html).toContain("bp-search-block-docs");
        expect(html).not.toContain('value="delivery"');
    });

    it("groups under the product labels, in the order the collection lists its products", async () => {
        const html = lead(await draw("docs"));
        const alpha = html.indexOf("Alpha product");
        const beta = html.indexOf("Beta product");
        expect(alpha).toBeGreaterThan(-1);
        expect(beta).toBeGreaterThan(alpha);
        expect(group(html, "Alpha product")).toContain("Quickstart");
        expect(group(html, "Alpha product")).not.toContain("Rendering with the press");
        expect(group(html, "Beta product")).toContain("Rendering with the press");
        expect(group(html, "Beta product")).toContain('href="/docs/press/press-quickstart"');
    });

    it("filters each group by the query and says No match here for a group left empty", async () => {
        const html = lead(await draw("docs", "delivery"));
        const alpha = group(html, "Alpha product");
        const beta = group(html, "Beta product");
        expect(alpha).toContain("Public delivery API");
        expect(alpha).not.toContain("Quickstart");
        expect(shown(alpha)).toBe(false);
        expect(beta).not.toContain("Rendering with the press");
        expect(shown(beta)).toBe(true);
        expect(beta).toContain("No match here");
    });

    it("is a labelled GET form, so it works with no script", async () => {
        const html = lead(await draw("docs"));
        expect(html).toContain('role="search"');
        expect(html).toContain('method="get"');
        expect(html).toContain('action="/docs"');
        expect(html).toContain('name="q"');
        expect(html).toMatch(/<label[^>]*for="bp-search-block-docs"/);
    });

    it("lists every entry under one unlabelled group for a collection with no products", async () => {
        landing = [{ type: "search", props: { collection: "guides", query: "{{query.q}}", groupBy: "product" } }];
        const html = lead(await draw("guides"));
        expect(html).toContain("Guide one");
        expect(html).toContain("Guide two");
        expect(html.match(/data-bp-search-group=/g)).toHaveLength(1);
        expect(html).not.toContain("bp-tree-search-group-label");
        expect(shown(html)).toBe(false);
    });

    it("draws the in-page index, hidden, for searchIndex with no grouping", async () => {
        landing = [{ type: "search", props: { collection: "docs", searchIndex: true } }];
        const html = lead(await draw("docs"));
        expect(html).toMatch(/data-bp-search-index="\d+"/);
        expect(html).toContain("Quickstart");
        expect(html).not.toContain("data-bp-search-group=");
    });

    it("leaves an existing search block as it was", async () => {
        landing = [{ type: "search", props: { collection: "docs", query: "delivery" } }];
        const html = lead(await draw("docs"));
        expect(html).toContain("Public delivery API");
        expect(html).not.toContain("data-bp-search-group");
        expect(html).not.toMatch(/data-bp-search-index="\d+"/);
        expect(html).not.toContain("No match here");
    });
});
