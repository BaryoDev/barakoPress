import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Docs as a configured collection (#23).
 *
 * The site under test is the one barakocms.com is becoming: a manual with sections, an order, nested
 * pages and two products, declared in a tenant's `Collections` setting and in nothing else. Nothing
 * here names a section, a product or a page: every one of them is content the tenant wrote.
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
        throw Object.assign(new Error(`NEXT_REDIRECT 307 ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT 308 ${to}`), { digest: "NEXT_REDIRECT" });
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
const { collectionTree, editHref, treeNeighbours, treeProducts } = await import("./tree.js");
const { siteConfig } = await import("./site.js");
const { createPage } = await import("./screens/page.js");
const { createCollectionIndex } = await import("./screens/collection.js");
const { createBlockRegistry, registryFor } = await import("./blocks/registry.js");
const { resolveBlocks } = await import("./blocks/schema.js");
const { BlockList } = await import("./blocks/render.js");
const { bindBlocks, itemScope, queryScope } = await import("./blocks/bind.js");
const { getItem } = await import("./collections.js");
const { createSitemap } = await import("./routes/sitemap.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

/*
 * The order fields deliberately do not match the alphabet, and "webhooks" has none at all, so an
 * ordering that ignored the field or fell back to the order rows came back in would be visible.
 */
const DOCS: Entry[] = [
    { id: "d1", slug: "quickstart", data: { Title: "Quickstart", Slug: "quickstart", Body: "Start here.", Section: "Getting started", Order: 1, Product: "cms", Source: "quickstart/README.md", Path: "/docs/cms/quickstart" } },
    { id: "d2", slug: "webhooks", data: { Title: "Webhooks and actions", Slug: "webhooks", Body: "Signed.", Section: "Reference", Product: "cms", Source: "docs/webhooks.md", Order: "not a number" } },
    { id: "d3", slug: "delivery-api", data: { Title: "Public delivery API", Slug: "delivery-api", Body: "Read it.", Section: "Reference", Order: 1, Product: "cms", Path: "/docs/cms/delivery-api" } },
    { id: "d4", slug: "delivery-paging", data: { Title: "Paging", Slug: "delivery-paging", Body: "A page at a time.", Section: "Reference", Order: 2, Parent: "delivery-api", Product: "cms", Path: "/docs/cms/delivery-paging" } },
    { id: "d5", slug: "press-quickstart", data: { Title: "Rendering with barakoPress", Slug: "press-quickstart", Body: "Install it.", Section: "Getting started", Order: 1, Product: "press" } },
    // A page whose parent was never published. It belongs on the page, at the top of its section.
    { id: "d6", slug: "orphan", data: { Title: "Orphaned note", Slug: "orphan", Body: "Still here.", Section: "Reference", Order: 9, Parent: "never-written", Product: "cms" } },
];

const DOCS_COLLECTION = {
    type: "doc",
    route: "/docs",
    label: "Documentation",
    layout: "article",
    fields: { title: "Title", slug: "Slug", body: "Body" },
    tree: {
        section: "Section",
        sections: ["Getting started", "Reference"],
        order: "Order",
        parent: "Parent",
        product: "Product",
        editPath: "Source",
        searchPath: "/docs",
        editBase: "https://github.com/BaryoDev/barakoCMS/edit/master/",
        products: [
            { key: "cms", label: "barakoCMS", href: "/docs" },
            { key: "press", label: "barakoPress", href: "/docs/press" },
            // Dropped: a destination that is neither a site path nor an http URL.
            { key: "bad", label: "Nowhere", href: "javascript:alert(1)" },
        ],
    },
};

const PAGES = [
    {
        id: "landing",
        slug: "manual",
        data: {
            Title: "The manual",
            Slug: "manual",
            Blocks: [
                { type: "docsSwitcher", props: { collection: "docs", current: "cms" } },
                { type: "search", props: { collection: "docs", query: "{{query.q}}" } },
                { type: "docsSidebar", props: { collection: "docs", product: "cms", current: "webhooks" } },
            ],
        },
    },
];

const SETTINGS = {
    Name: "barakoCMS",
    Url: "https://barakocms.com",
    Collections: { docs: DOCS_COLLECTION },
};

type Call = { path: string };
let calls: Call[] = [];

function cms(settings: Record<string, unknown> = SETTINGS) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push({ path: url.pathname + url.search });

        if (url.pathname === "/api/tenants/by-host/barakocms.com") return Response.json({ handle: "cms" });
        if (tenant !== "cms") return new Response("", { status: 404 });

        const paged = (items: unknown[]) => {
            const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
            const size = Math.min(Number(url.searchParams.get("pageSize") ?? 20), 100);
            const from = (page - 1) * size;
            const rows = items.slice(from, from + size);
            return Response.json({
                items: rows,
                page,
                pageSize: size,
                totalItems: items.length,
                totalPages: Math.max(1, Math.ceil(items.length / size)),
                hasNextPage: from + rows.length < items.length,
            });
        };

        if (url.pathname === "/api/public/site") return paged([{ id: "s", data: settings }]);
        if (url.pathname === "/api/public/doc/search") {
            const q = (url.searchParams.get("q") ?? "").toLowerCase();
            const results = DOCS.filter((d) => String(d.data.Title).toLowerCase().includes(q));
            return Response.json({ results, count: results.length, query: q });
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const found = PAGES.find((p) => `/${p.slug}` === url.searchParams.get("path"));
            return found ? Response.json({ contract: 1, path: `/${found.slug}`, entry: found, breadcrumbs: [] }) : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 1, items: [] });
        if (url.pathname.startsWith("/api/public/redirects/")) return new Response("", { status: 404 });

        const [type, slug] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        if (type !== "doc") return new Response("", { status: 404 });
        if (slug) {
            const found = DOCS.find((d) => d.slug === decodeURIComponent(slug));
            return found ? Response.json(found) : new Response("", { status: 404 });
        }
        let listed = DOCS;
        for (const [key, value] of url.searchParams) {
            const m = key.match(/^filter\[(.+)\]\[eq\]$/);
            if (m) listed = listed.filter((d) => d.data[m[1]] === value);
        }
        return paged(listed);
    });
}

const base = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

async function site() {
    requestHeaders = new Headers({ host: "barakocms.com" });
    return siteConfig(base);
}

/*
 * Streamed rather than rendered synchronously, because these screens and blocks are async components
 * and the synchronous renderer refuses one. This is the renderer that behaves like the server.
 */
async function markup(node: Promise<ReactNode> | ReactNode): Promise<string> {
    const stream = await renderToReadableStream(await node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** Text between two markers, so an assertion about the sidebar cannot be satisfied by the body. */
function between(html: string, open: string, close: string): string {
    const from = html.indexOf(open);
    if (from < 0) return "";
    const to = html.indexOf(close, from + open.length);
    return to < 0 ? html.slice(from) : html.slice(from, to);
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a collection configured as a tree", () => {
    it("groups its items into sections, in the order the sections first appear", async () => {
        const config = await site();
        const tree = await collectionTree(config, "docs", { product: "cms" });

        expect(tree.sections).toHaveLength(2);
        expect(tree.sections.map((s) => s.name)).toEqual(["Getting started", "Reference"]);
        expect(tree.truncated).toBe(false);
    });

    it("orders by the order field, puts an item with none last, and nests a child under its parent", async () => {
        const config = await site();
        const { sections } = await collectionTree(config, "docs", { product: "cms" });

        const reference = sections.find((s) => s.name === "Reference");
        expect(reference).toBeDefined();
        expect(reference!.nodes.length).toBeGreaterThan(0);
        // "delivery-api" is first on its order of 1, "orphan" next on 9, "webhooks" last with none.
        expect(reference!.nodes.map((n) => n.item.slug)).toEqual(["delivery-api", "orphan", "webhooks"]);
        expect(reference!.nodes[0].children.map((n) => n.item.slug)).toEqual(["delivery-paging"]);
        expect(reference!.nodes[0].href).toBe("/docs/delivery-api");
    });

    it("walks previous and next in reading order, parents before their children", async () => {
        const config = await site();
        const { order } = await collectionTree(config, "docs", { product: "cms" });

        expect(order.map((i) => i.slug)).toEqual([
            "quickstart",
            "delivery-api",
            "delivery-paging",
            "orphan",
            "webhooks",
        ]);
        expect(treeNeighbours(order, "delivery-paging")).toMatchObject({
            previous: { slug: "delivery-api" },
            next: { slug: "orphan" },
        });
        expect(treeNeighbours(order, "quickstart").previous).toBeUndefined();
        expect(treeNeighbours(order, "webhooks").next).toBeUndefined();
        expect(treeNeighbours(order, "not-a-page")).toEqual({});
    });

    it("asks the API for one product rather than reading the lot and filtering here", async () => {
        const config = await site();
        calls = [];
        const { order } = await collectionTree(config, "docs", { product: "press" });

        expect(order.map((i) => i.slug)).toEqual(["press-quickstart"]);
        const listed = calls.filter((c) => c.path.startsWith("/api/public/doc?"));
        expect(listed.length).toBeGreaterThan(0);
        expect(listed.every((c) => c.path.includes("filter%5BProduct%5D%5Beq%5D=press"))).toBe(true);
    });

    it("offers the products the settings named, drops one that is not a link, and marks the current one", async () => {
        const config = await site();
        const products = treeProducts(config, "docs", "press");

        expect(products).toHaveLength(2);
        expect(products.map((p) => p.key)).toEqual(["cms", "press"]);
        expect(products.find((p) => p.key === "press")!.current).toBe(true);
        expect(products.find((p) => p.key === "cms")!.current).toBe(false);
    });

    it("builds the edit link from the setting and the item's own source path", async () => {
        const config = await site();
        const { order } = await collectionTree(config, "docs", { product: "cms" });
        expect(order.length).toBeGreaterThan(0);

        const webhooks = order.find((i) => i.slug === "webhooks");
        expect(webhooks).toBeDefined();
        expect(editHref(config, webhooks!)).toBe("https://github.com/BaryoDev/barakoCMS/edit/master/docs/webhooks.md");
        // No source path, so the slug stands in.
        const paging = order.find((i) => i.slug === "delivery-paging");
        expect(editHref(config, paging!)).toBe("https://github.com/BaryoDev/barakoCMS/edit/master/delivery-paging");
    });
});

describe("a docs page", () => {
    it("draws the sidebar, the switcher, previous and next and the edit link around the page", async () => {
        const config = await site();
        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "delivery-paging"] }) }));

        // The page itself.
        expect(html).toContain("Paging");
        expect(html).toContain("A page at a time.");
        // The sidebar, with the page being read marked and not linked.
        expect(html).toContain("Getting started");
        expect(html).toContain('href="/docs/quickstart"');
        expect(html).toContain('aria-current="page"');
        expect(html).not.toContain('href="/docs/delivery-paging"');
        // The switcher, from the settings, with the product being read not linked.
        expect(html).toContain("barakoPress");
        expect(html).toContain('href="/docs/press"');
        // Previous and next from the tree's reading order, not from the alphabet.
        const pager = between(html, 'rel="prev"', "</nav>");
        expect(pager).toContain("Public delivery API");
        expect(html).toContain('href="/docs/orphan"');
        // Where the page is written.
        expect(html).toContain("https://github.com/BaryoDev/barakoCMS/edit/master/delivery-paging");
        expect(html).toContain("Edit this page");
    });

    it("draws a search box the reader can use with no script at all, where the tree says search lives", async () => {
        requestHeaders = new Headers({ host: "barakocms.com" });
        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "webhooks"] }) }));

        expect(html).toContain('role="search"');
        expect(html).toContain('action="/docs"');
        expect(html).toContain('name="q"');
    });

    /*
     * Only the site knows which of its routes reads the query, and a kept route cannot. A box
     * submitting somewhere that ignores `q` would send a reader to an unfiltered index and look
     * like a search that found everything.
     */
    it("draws no search box when the tree names nowhere that reads the query", async () => {
        const quiet = { ...SETTINGS, Collections: { docs: { ...DOCS_COLLECTION, tree: { ...DOCS_COLLECTION.tree, searchPath: undefined } } } };
        vi.stubGlobal("fetch", cms(quiet));
        requestHeaders = new Headers({ host: "barakocms.com" });
        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "webhooks"] }) }));

        expect(html).toContain("Webhooks and actions");
        expect(html).not.toContain('role="search"');
    });

    it("answers a query on the index with what the API matched", async () => {
        const index = createCollectionIndex(base, "docs", { search: true });
        requestHeaders = new Headers({ host: "barakocms.com" });
        const html = await markup(index({ searchParams: Promise.resolve({ q: "delivery" }) }));

        // The results and not the sidebar, which lists every page whatever was searched for.
        const results = between(html, 'class="shell"', "</aside>");
        expect(results).toContain("Public delivery API");
        expect(results).not.toContain("Quickstart");
        expect(calls.some((c) => c.path.startsWith("/api/public/doc/search?"))).toBe(true);
    });

    it("says so rather than showing an empty index when a query matched nothing", async () => {
        const index = createCollectionIndex(base, "docs", { search: true });
        requestHeaders = new Headers({ host: "barakocms.com" });
        const html = await markup(index({ searchParams: Promise.resolve({ q: "nothing-like-this" }) }));

        expect(html).toContain("Nothing matches that.");
    });
});

describe("the docs blocks", () => {
    /** A page's blocks, resolved, bound to a query and rendered, as `createPage` does it. */
    async function page(query: Record<string, string>) {
        const config = await site();
        const registry = registryFor(config, createBlockRegistry(base));
        const blocks = await bindBlocks(resolveBlocks(PAGES[0].data.Blocks, registry, { perViewer: false }), {
            config,
            registry,
            scopes: { query: async () => queryScope(query) },
        });
        expect(blocks.length).toBeGreaterThan(0);
        return markup(BlockList({ blocks, theme: config.theme }));
    }

    it("render the same sidebar, switcher and search a docs page draws", async () => {
        const html = await page({});

        expect(html).toContain("Getting started");
        expect(html).toContain('href="/docs/quickstart"');
        expect(html).toContain("barakoCMS");
        expect(html).toContain('role="search"');
    });

    it("mark the page the sidebar block was told is current", async () => {
        const html = await page({});
        expect(between(html, 'aria-current="page"', "</span>")).toContain("Webhooks and actions");
    });

    /*
     * The bug this catches: every block that reads the site used to be rebound by replacing it with a
     * freshly built `collection`, whatever it was. A page with a sidebar on it got a list of documents
     * where the sidebar belonged, on every request-time site, which is every site that has a tenant.
     */
    it("stay themselves when the request rebinds the blocks that read the site", async () => {
        const config = await site();
        const bound = registryFor(config, createBlockRegistry(base));

        expect(bound.get("docsSidebar")?.type).toBe("docsSidebar");
        expect(bound.get("docsSwitcher")?.type).toBe("docsSwitcher");
        expect(bound.get("search")?.type).toBe("search");
        expect(bound.get("collection")?.type).toBe("collection");
    });

    it("run the search a page's query names, through the API's own search", async () => {
        const html = await page({ q: "delivery" });

        expect(html).toContain("Public delivery API");
        expect(html).toContain('href="/docs/delivery-api"');
        expect(html).not.toContain("Rendering with barakoPress");
        expect(calls.some((c) => c.path.startsWith("/api/public/doc/search?"))).toBe(true);
    });
});

/*
 * The unchanged callers of what this changed (the interaction surface), each crossed here rather
 * than argued about: `blocks/bind.ts` reads an `Item` and now sees one with four more roles on it,
 * and `routes/sitemap.ts` pages a collection that is now a tree. Both are files this branch did not
 * touch, and both would fail in a way the tests above cannot see.
 */
describe("what else reads an item of a tree", () => {
    it("binds the tenant's own field names, and gains no engine name that could shadow one", async () => {
        const config = await site();
        const item = await getItem(config, "docs", "webhooks");
        expect(item).not.toBeNull();
        const scope = itemScope(config, item!);

        // The tenant's own names, straight off the entry.
        expect(scope.Section).toBe("Reference");
        expect(scope.Product).toBe("cms");
        expect(scope.Source).toBe("docs/webhooks.md");
        // `Order` on this entry is not a number, which is what the tree drops and a binding must not.
        // If the scope ever grew an engine-named `Order`, this would read undefined instead.
        expect(item!.order).toBeUndefined();
        expect(scope.Order).toBe("not a number");
        // The roles the tree reads are on the item, and deliberately not extra binding names.
        expect(item!.section).toBe("Reference");
        expect(Object.keys(scope)).not.toContain("Parent");
        expect(Object.keys(scope)).not.toContain("EditPath");
    });

    it("puts a tree collection's pages in the sitemap, every product of them", async () => {
        requestHeaders = new Headers({ host: "barakocms.com" });
        const entries = await createSitemap(base)();

        expect(entries.length).toBeGreaterThan(0);
        const urls = entries.map((e) => e.url);
        expect(urls).toContain("https://barakocms.com/docs/webhooks");
        expect(urls).toContain("https://barakocms.com/docs/press-quickstart");
    });
});

/*
 * Slugs are unique across a tenant, so a manual whose products each have a quickstart keeps
 * "cms-quickstart" as the slug and names the path it is read at in a field, as a card's link does.
 * The tree, the pager, the in-page index and the sitemap all follow that field, and an item without
 * it is still read at its route and slug.
 */
describe("a manual whose items name their own path", () => {
    function pathed() {
        const settings = {
            ...SETTINGS,
            Collections: {
                docs: {
                    ...DOCS_COLLECTION,
                    fields: { ...DOCS_COLLECTION.fields, href: "Path" },
                    tree: { ...DOCS_COLLECTION.tree, searchIndex: true },
                },
            },
        };
        vi.stubGlobal("fetch", cms(settings));
        requestHeaders = new Headers({ host: "barakocms.com" });
    }

    it("links each item where it says it is read, in the sidebar, the pager and the index", async () => {
        pathed();
        const config = await site();
        const tree = await collectionTree(config, "docs", { product: "cms" });
        const nodes = tree.sections.flatMap((s) => s.nodes);
        expect(nodes.length).toBeGreaterThan(2);
        expect(nodes.find((n) => n.item.slug === "quickstart")?.href).toBe("/docs/cms/quickstart");
        expect(nodes.find((n) => n.item.slug === "webhooks")?.href).toBe("/docs/webhooks");

        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "orphan"] }) }));
        const sidebar = between(html, 'class="bp-tree-sections"', "</nav>");
        expect(sidebar).toContain('href="/docs/cms/delivery-api"');
        expect(sidebar).toContain('href="/docs/cms/delivery-paging"');
        expect(sidebar).not.toContain('href="/docs/delivery-api"');
        const pager = between(html, 'class="bp-tree-pager"', "</nav>");
        expect(pager).toContain('href="/docs/cms/delivery-paging"');
        expect(pager).toContain('href="/docs/webhooks"');
        expect(html).toContain('<li><a href="/docs/cms/quickstart"><span>Quickstart</span></a></li>');
    });

    it("links an item of a tree off site only at its route, never at an absolute href", async () => {
        const { treeItemHref } = await import("./tree.js");
        expect(treeItemHref({ slug: "phish", href: "https://evil.example/phish" }, "/docs")).toBe("/docs/phish");
        expect(treeItemHref({ slug: "q", href: "//evil.example/q" }, "/docs")).toBe("/docs/q");
        expect(treeItemHref({ slug: "q", href: "/docs/cms/q/" }, "/docs")).toBe("/docs/cms/q/");
        // A browser reads a backslash as a slash, so "/\\host" is off site too.
        expect(treeItemHref({ slug: "b", href: "/\\evil.example/phish" }, "/docs")).toBe("/docs/b");
        expect(treeItemHref({ slug: "c", href: "/docs\\x" }, "/docs")).toBe("/docs/c");
        expect(treeItemHref({ slug: "t", href: "/\tevil.example" }, "/docs")).toBe("/docs/t");
    });

    it("lists each item in the sitemap at its own path", async () => {
        pathed();
        const entries = await createSitemap(base)();
        const urls = entries.map((e) => e.url);
        expect(urls.length).toBeGreaterThan(3);
        expect(urls).toContain("https://barakocms.com/docs/cms/quickstart");
        expect(urls).not.toContain("https://barakocms.com/docs/quickstart");
        expect(urls).toContain("https://barakocms.com/docs/webhooks");
    });
});

/*
 * Only a tree's items are listed at their `href`: a card's target on any other collection is where the
 * card sends a reader, not where the item is served. A fragment or a query is not a page of its own,
 * and two items naming one path are one URL.
 */
describe("the sitemap and an href field", () => {
    it("follows href only for a tree, without its fragment or query, and lists a path once", async () => {
        const settings = {
            ...SETTINGS,
            Collections: {
                docs: {
                    ...DOCS_COLLECTION,
                    fields: { ...DOCS_COLLECTION.fields, href: "Path" },
                },
                pages: { type: "doc", route: "/cards", fields: { title: "Title", slug: "Slug", href: "Path" } },
            },
        };
        const saved = [...DOCS];
        DOCS.push(
            { id: "d7", slug: "contact-a", data: { Title: "A", Slug: "contact-a", Path: "/docs/cms/quickstart#top", Section: "Reference", Product: "cms" } },
            { id: "d8", slug: "contact-b", data: { Title: "B", Slug: "contact-b", Path: "/docs/cms/quickstart?x=1", Section: "Reference", Product: "cms" } },
        );
        try {
            vi.stubGlobal("fetch", cms(settings));
            requestHeaders = new Headers({ host: "barakocms.com" });
            const urls = (await createSitemap(base)()).map((e) => e.url);
            expect(urls.length).toBeGreaterThan(3);
            expect(urls.filter((u) => u === "https://barakocms.com/docs/cms/quickstart")).toHaveLength(1);
            expect(urls.some((u) => u.includes("#") || u.includes("?"))).toBe(false);
            // The card collection over the same entries lists them at its route, never at the cards' targets.
            expect(urls).toContain("https://barakocms.com/cards/quickstart");
            expect(urls).toContain("https://barakocms.com/cards/contact-a");
        } finally {
            DOCS.splice(0, DOCS.length, ...saved);
        }
    });

    it("never lists the home page twice through a tree item that names it", async () => {
        const settings = {
            ...SETTINGS,
            Collections: { docs: { ...DOCS_COLLECTION, fields: { ...DOCS_COLLECTION.fields, href: "Path" } } },
        };
        const saved = [...DOCS];
        DOCS.push({ id: "d9", slug: "home", data: { Title: "Home", Slug: "home", Path: "/", Section: "Reference", Product: "cms" } });
        try {
            vi.stubGlobal("fetch", cms(settings));
            requestHeaders = new Headers({ host: "barakocms.com" });
            const urls = (await createSitemap(base)()).map((e) => e.url.replace(/\/$/, ""));
            expect(urls.length).toBeGreaterThan(3);
            expect(urls.filter((u) => u === "https://barakocms.com")).toHaveLength(1);
        } finally {
            DOCS.splice(0, DOCS.length, ...saved);
        }
    });
});

describe("a manual whose CMS stopped answering", () => {
    /** Every read fails except the one entry being read, which is what a half-gone CMS looks like. */
    function failing() {
        return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            const tenant = new Headers(init?.headers).get("x-tenant");
            if (url.pathname === "/api/tenants/by-host/barakocms.com") return Response.json({ handle: "cms" });
            if (tenant !== "cms") return new Response("", { status: 404 });
            if (url.pathname === "/api/public/site") {
                return Response.json({ items: [{ id: "s", data: SETTINGS }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false });
            }
            const found = DOCS.find((d) => url.pathname === `/api/public/doc/${d.slug}`);
            return found ? Response.json(found) : new Response("", { status: 500 });
        });
    }

    it("still serves the page, and loses the sidebar rather than the page", async () => {
        vi.stubGlobal("fetch", failing());
        requestHeaders = new Headers({ host: "barakocms.com" });
        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "webhooks"] }) }));

        expect(html).toContain("Webhooks and actions");
        expect(html).toContain("Signed.");
        // The search box needs no read of its own, so it stays while the sidebar cannot be drawn.
        expect(html).toContain('role="search"');
        // The sidebar had nothing to draw, so it drew nothing rather than throwing.
        expect(html).not.toContain('href="/docs/quickstart"');
    });

    it("leaves the manual out of the sitemap rather than throwing, which would fail a build", async () => {
        vi.stubGlobal("fetch", failing());
        requestHeaders = new Headers({ host: "barakocms.com" });
        const entries = await createSitemap(base)();

        expect(entries.map((e) => e.url).some((url) => url.includes("/docs/"))).toBe(false);
    });
});

describe("a manual laid out by its settings (#130)", () => {
    function laidOut(tree: Record<string, unknown>) {
        const settings = { ...SETTINGS, Collections: { docs: { ...DOCS_COLLECTION, tree: { ...DOCS_COLLECTION.tree, ...tree } } } };
        vi.stubGlobal("fetch", cms(settings));
        requestHeaders = new Headers({ host: "barakocms.com" });
    }

    it("takes the variants, the in-page index and a product's note from the tenant's Collections", async () => {
        laidOut({
            variant: { switcher: "list", sidebar: "boxed", rail: true, pager: "halves", search: "compact", disclosure: "closed" },
            searchIndex: true,
            icons: { search: "#ic-search", chevron: "#ic-chevron-down" },
            products: [
                { key: "cms", label: "barakoCMS", href: "/docs" },
                { key: "press", label: "barakoPress", href: "https://github.com/BaryoDev/barakoPress", note: "on GitHub" },
            ],
        });
        const config = await site();
        expect(config.collections.docs.tree?.variant).toEqual({
            switcher: "list",
            sidebar: "boxed",
            rail: true,
            pager: "halves",
            search: "compact",
            disclosure: "closed",
        });
        expect(config.collections.docs.tree?.icons).toEqual({ search: "#ic-search", chevron: "#ic-chevron-down" });
        expect(config.collections.docs.tree?.searchIndex).toBe(true);

        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "delivery-paging"] }) }));
        expect(html).toContain("bp-tree-shell-boxed");
        expect(html).toContain("bp-tree-switcher-list");
        expect(html).toContain(">on GitHub</span>");
        expect(html).toContain("data-bp-search-index");
        expect(html).toContain("bp-tree-search-compact");
        expect(html).toContain("bp-tree-nav-closed");
        expect(html).toContain(">Paging</span>");
        // Every page of the product is in the index, the one being read included.
        expect(html).toContain('<li><a href="/docs/quickstart"><span>Quickstart</span></a></li>');
        expect(html).toContain('<li><a href="/docs/delivery-paging"><span>Paging</span></a></li>');
    });

    it("keeps today's layout for a part whose variant it does not know, and ignores a rail that is not true", async () => {
        laidOut({
            variant: { switcher: "carousel", sidebar: "floating", rail: "yes", pager: 2, search: "huge", disclosure: "sometimes" },
            searchIndex: "yes",
            icons: { search: "javascript:alert(1)", chevron: "#ok\" onload=\"x" },
        });
        const config = await site();
        expect(config.collections.docs.tree?.variant).toBeUndefined();
        expect(config.collections.docs.tree?.searchIndex).toBeUndefined();
        expect(config.collections.docs.tree?.icons).toBeUndefined();

        const html = await markup(createPage(base)({ params: Promise.resolve({ path: ["docs", "delivery-paging"] }) }));
        expect(html).toContain("bp-tree-switcher-tabs");
        expect(html).not.toContain("bp-tree-shell-boxed");
        expect(html).not.toContain("data-bp-search-index");
    });
});
