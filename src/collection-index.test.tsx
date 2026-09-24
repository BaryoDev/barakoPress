import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A collection's index copy, its index page and its default byline as settings (#126), and the rule
 * that came with them: a page that only holds data or chrome is not a place to go. It answers 404 at
 * its own path and is left out of the menu and the sitemap.
 *
 * A site that sets none of these renders as it did. test/blog-wrappers.golden.json and
 * src/regions.test.tsx hold that claim; this file holds the new settings.
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
const { applySiteSettings } = await import("./site.js");
const { createPage, createPageMetadata } = await import("./screens/page.js");
const { createCollectionIndex } = await import("./screens/collection.js");
const { createBlogIndex } = await import("./screens/blog-index.js");
const { createSiteLayout } = await import("./screens/site-layout.js");
const { createSitemap } = await import("./routes/sitemap.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const ANA = { id: "a1", slug: "ana", data: { Name: "Ana Cruz", Slug: "ana" } };

const NOTES: Entry[] = [
    { id: "n1", slug: "signed", data: { Title: "A signed note", Slug: "signed", Author: ANA, Body: "Signed." } },
    { id: "n2", slug: "unsigned", data: { Title: "An unsigned note", Slug: "unsigned", Body: "Nobody signed this." } },
];

const NOTES_COLLECTION = {
    type: "note",
    route: "/notes",
    label: "Notes",
    layout: "article",
    fields: { title: "Title", slug: "Slug", body: "Body" },
    references: { Author: { collection: "authors", label: "by" } },
};
const AUTHORS_COLLECTION = { type: "author", route: "/authors", fields: { title: "Name", slug: "Slug" } };

const INDEX_COPY = {
    eyebrow: "From the desk",
    heading: "Field notes",
    lede: "Short things we wrote down.",
    empty: "No notes yet, check back on Friday.",
    unavailable: "The notes are resting. Try again in a minute.",
};

const INDEX_PAGE_BLOCKS = [{ type: "text", props: { value: "Subscribe for the Friday notes", variant: "heading" } }];

const NAVIGATION = {
    contract: 1,
    items: [
        { id: "a", title: "About", slug: "about", path: "/about", order: 1, children: [] },
        { id: "d", title: "Notes index", slug: "site-notes", path: "/site-notes", order: 2, children: [] },
        { id: "f", title: "Footer", slug: "footer", path: "/site-footer", order: 3, children: [] },
    ],
};

type Tenant = {
    host: string;
    settings: Record<string, unknown>;
    content: Record<string, Entry[] | "down">;
    pages?: Record<string, Entry>;
};

const TENANTS: Record<string, Tenant> = {
    // Every new setting on, with an index page and a footer region in the menu.
    studio: {
        host: "studio.example",
        settings: {
            Name: "Studio",
            Url: "https://studio.example",
            FooterPath: "/site-footer",
            Collections: {
                notes: { ...NOTES_COLLECTION, index: INDEX_COPY, indexPage: "/site-notes", defaultAuthor: "The Studio team" },
                authors: AUTHORS_COLLECTION,
                letters: {
                    ...NOTES_COLLECTION,
                    route: "/letters",
                    references: { Author: { collection: "authors", label: "from" } },
                    defaultAuthor: "The Studio team",
                },
                post: { type: "post", route: "/blog", fields: { title: "Title" }, index: { heading: "Writing" } },
            },
        },
        content: {
            note: NOTES,
            author: [ANA],
            post: [],
            page: [
                { id: "p1", slug: "about", data: { Title: "About", Slug: "about", Body: "About us" } },
                { id: "p2", slug: "site-notes", data: { Title: "Notes index", Slug: "site-notes", Blocks: INDEX_PAGE_BLOCKS } },
                { id: "p3", slug: "site-footer", data: { Title: "Footer", Slug: "site-footer", Body: "Footer" } },
            ],
        },
        pages: {
            "/about": { id: "p1", slug: "about", data: { Title: "About", Blocks: [{ type: "text", props: { value: "About us" } }] } },
            "/site-notes": { id: "p2", slug: "site-notes", data: { Title: "Notes index", Blocks: INDEX_PAGE_BLOCKS } },
            "/site-footer": { id: "p3", slug: "site-footer", data: { Title: "Footer", Blocks: [{ type: "text", props: { value: "Footer" } }] } },
        },
    },
    // The same collection with no new setting: the engine's own words.
    plain: {
        host: "plain.example",
        settings: {
            Name: "Plain",
            Url: "https://plain.example",
            Collections: { notes: NOTES_COLLECTION, authors: AUTHORS_COLLECTION },
        },
        content: { note: NOTES, author: [ANA], post: [] },
    },
    // Every setting on and nothing published.
    quiet: {
        host: "quiet.example",
        settings: { Name: "Quiet", Url: "https://quiet.example", Collections: { notes: { ...NOTES_COLLECTION, index: INDEX_COPY } } },
        content: { note: [], post: [] },
    },
    // Every setting on and a CMS that fails the read.
    down: {
        host: "down.example",
        settings: { Name: "Down", Url: "https://down.example", Collections: { notes: { ...NOTES_COLLECTION, index: INDEX_COPY } } },
        content: { note: "down", post: [] },
    },
};

let calls: string[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push(url.pathname + url.search);

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });

        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") return paged([{ id: "s", data: t.settings }]);
        if (url.pathname === "/api/public/pages/navigation") return Response.json(NAVIGATION);
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "/";
            const entry = t.pages?.[path];
            return entry
                ? Response.json({ contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        if (url.pathname.startsWith("/api/public/redirects")) return new Response("", { status: 404 });

        const [type, slug] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        const entries = t.content[type];
        if (entries === "down") return new Response("", { status: 500 });
        if (!entries) return new Response("", { status: 404 });
        if (slug) {
            const found = entries.find((e) => e.slug === decodeURIComponent(slug));
            return found ? Response.json(found) : new Response("", { status: 404 });
        }
        return paged(entries);
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

async function render(node: ReactNode): Promise<string> {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

/** What the root catch-all serves at `path` for `host`. */
async function at(host: string, path: string): Promise<string> {
    requestHeaders = new Headers({ host });
    const Page = createPage(config);
    const segments = path.split("/").filter(Boolean);
    return render(await Page({ params: Promise.resolve({ path: segments }), searchParams: Promise.resolve({}) }));
}

async function notFoundAt(host: string, path: string): Promise<boolean> {
    try {
        await at(host, path);
        return false;
    } catch (e) {
        return e instanceof Error && e.message === "NEXT_NOT_FOUND";
    }
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    calls = [];
    vi.stubGlobal("fetch", cms());
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("reading the collection settings", () => {
    const base = { ...config, tenant: "t" };
    const read = (extra: Record<string, unknown>) =>
        applySiteSettings(base, { Collections: { notes: { ...NOTES_COLLECTION, ...extra } } }, null).collections.notes;

    it("reads the index copy, the index page and the default byline", () => {
        const col = read({ index: INDEX_COPY, indexPage: "/site-notes/", defaultAuthor: "The Studio team" });
        expect(col.index).toEqual(INDEX_COPY);
        expect(col.indexPage).toBe("/site-notes");
        expect(col.defaultAuthor).toBe("The Studio team");
    });

    it("keeps index false and true as they were, and adds no key a site did not set", () => {
        expect(read({ index: false }).index).toBe(false);
        const col = read({});
        expect(col.index).toBe(true);
        expect(Object.hasOwn(col, "indexPage")).toBe(false);
        expect(Object.hasOwn(col, "defaultAuthor")).toBe(false);
    });

    it("drops a copy line of the wrong kind or length and keeps the rest", () => {
        expect(read({ index: { heading: "Kept", lede: 5, eyebrow: "x".repeat(500) } }).index).toEqual({ heading: "Kept" });
        expect(read({ index: { lede: 5 } }).index).toBe(true);
    });

    it("drops an index page that is not a plain site path", () => {
        for (const path of ["site-notes", "//evil.example/x", "https://evil.example/", "/a b", 5]) {
            expect(Object.hasOwn(read({ indexPage: path }), "indexPage")).toBe(false);
        }
    });
});

describe("a collection's index copy", () => {
    it("draws the eyebrow, the heading and the lede an editor set", async () => {
        const html = await at("studio.example", "/notes");
        expect(html).toContain('<p class="eyebrow">From the desk</p>');
        expect(html).toContain("<h1>Field notes</h1>");
        expect(html).toContain('<p class="tagline">Short things we wrote down.</p>');
        expect(html).not.toContain("<h1>Notes</h1>");
    });

    it("draws the engine's own words when none is set", async () => {
        const html = await at("plain.example", "/notes");
        expect(html).toContain("<h1>Notes</h1>");
        expect(html).not.toContain("eyebrow");
    });

    it("says the empty line an editor wrote, in place of the engine's", async () => {
        const html = await at("quiet.example", "/notes");
        expect(html).toContain("No notes yet, check back on Friday.");
        expect(html).not.toContain("Nothing published yet.");
        expect(html).not.toContain("opted into public delivery");
    });

    it("says the unavailable line an editor wrote when the read fails", async () => {
        const html = await at("down.example", "/notes");
        expect(html).toContain("The notes are resting. Try again in a minute.");
        expect(html).not.toContain("This page could not be loaded.");
    });

    it("is drawn by a route file's collection index and by the blog index", async () => {
        requestHeaders = new Headers({ host: "studio.example" });
        expect(await render(await createCollectionIndex(config, "notes")())).toContain("<h1>Field notes</h1>");
        requestHeaders = new Headers({ host: "studio.example" });
        expect(await render(await createBlogIndex(config)())).toContain("<h1>Writing</h1>");
    });
});

describe("a collection's index page", () => {
    it("renders the page's blocks above the list on the index route", async () => {
        const html = await at("studio.example", "/notes");
        const lead = html.indexOf("Subscribe for the Friday notes");
        expect(lead).toBeGreaterThan(-1);
        expect(lead).toBeLessThan(html.indexOf("A signed note"));
    });

    it("reads no page for a collection that names none", async () => {
        await at("plain.example", "/notes");
        expect(calls.some((c) => c.startsWith("/api/public/pages/resolve"))).toBe(false);
    });
});

describe("a default byline", () => {
    it("names the default author on a card whose entry names none, and the entry's own author otherwise", async () => {
        const html = await at("studio.example", "/notes");
        const signed = html.slice(html.indexOf("A signed note"), html.indexOf("An unsigned note"));
        const unsigned = html.slice(html.indexOf("An unsigned note"));
        expect(signed).toContain("Ana Cruz");
        expect(signed).not.toContain("The Studio team");
        expect(unsigned).toContain("by The Studio team");
    });

    it("is the byline on the item page of an entry that names no author", async () => {
        const unsigned = await at("studio.example", "/notes/unsigned");
        expect(unsigned).toContain("The Studio team");
        const signed = await at("studio.example", "/notes/signed");
        expect(signed).toContain("Ana Cruz");
        expect(signed).not.toContain("The Studio team");
    });

    /*
     * The article draws `labels.by` before every byline, a signed one too, so the default author
     * takes the same word there. The card puts the reference's own label before a signed author, so
     * the default author takes that label there.
     */
    it("takes the word each view already puts before a byline", async () => {
        // The word between the monogram and the name in the article's byline.
        const word = (html: string, name: string) =>
            html.match(new RegExp(`</span>(\\w+)<!-- --> <(?:a|span)[^>]*>${name}<`))?.[1];

        const index = await at("studio.example", "/letters");
        expect(index).toContain("from The Studio team");

        expect(word(await at("studio.example", "/letters/signed"), "Ana Cruz")).toBe("by");
        expect(word(await at("studio.example", "/letters/unsigned"), "The Studio team")).toBe("by");
    });

    it("draws no byline for an entry with no author when none is set", async () => {
        expect(await at("plain.example", "/notes/unsigned")).not.toContain("The Studio team");
    });
});

describe("a page that only holds data or chrome", () => {
    it("answers 404 at its own path, an index page and a region page alike", async () => {
        expect(await notFoundAt("studio.example", "/site-notes")).toBe(true);
        expect(await notFoundAt("studio.example", "/site-footer")).toBe(true);
        expect(await notFoundAt("studio.example", "/about")).toBe(false);
    });

    it("answers 404 on a route that reads a page by slug, when that slug is a data path", async () => {
        const bySlug = async (slug: string) => {
            requestHeaders = new Headers({ host: "studio.example" });
            const Page = createPage(config);
            try {
                await render(await Page({ params: Promise.resolve({ slug }) }));
                return "rendered";
            } catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
        };
        expect(await bySlug("site-notes")).toBe("NEXT_NOT_FOUND");
        expect(await bySlug("site-footer")).toBe("NEXT_NOT_FOUND");
        expect(await bySlug("about")).toBe("rendered");
    });

    it("has no page metadata at its own path", async () => {
        requestHeaders = new Headers({ host: "studio.example" });
        const meta = await createPageMetadata(config)({ params: Promise.resolve({ path: ["site-notes"] }) });
        expect(meta.title).toBe("Not found");
    });

    it("is left out of the sitemap", async () => {
        requestHeaders = new Headers({ host: "studio.example" });
        const urls = (await createSitemap(config)()).map((e) => e.url);
        expect(urls).toContain("https://studio.example/about");
        expect(urls).not.toContain("https://studio.example/site-notes");
        expect(urls).not.toContain("https://studio.example/site-footer");
    });

    it("is left out of the menu", async () => {
        requestHeaders = new Headers({ host: "studio.example" });
        const Layout = createSiteLayout(config, { loadFonts: false });
        const html = await render(await Layout({ children: <p>the page</p> }));
        expect(html).toContain('href="/about"');
        expect(html).not.toContain('href="/site-notes"');
    });
});
