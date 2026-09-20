import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The generic item view rendering what the post view renders (barakoPress #75).
 *
 * #75 asked for the gap between `ItemView` and `PostView` to be closed or written down. It is closed:
 * the reading column, the byline, the read time and the band are a layout any collection can ask for
 * with `layout: "article"`, and `PostView` is a wrapper over it. The blog's side of that claim is
 * `test/blog-wrappers.golden.json`, which still passes byte for byte. This file is the other side: a
 * collection that is not a blog, drawn the way a long-form article wants, with none of the blueprint's
 * type names, field names or routes anywhere in it.
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
const { getPost, listPosts, listPostsBy, toPost } = await import("./cms.js");
const { siteConfig } = await import("./site.js");
const { createCollectionDetail } = await import("./screens/collection.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

/** Long enough to be worth a read time: 500 words is three minutes at the engine's 200 a minute. */
const STORY = Array.from({ length: 500 }, () => "word").join(" ");

const REPORTERS: Entry[] = [
    { id: "r1", slug: "lina", data: { Name: "Lina Abad", Slug: "lina", Bio: "Covers the port." } },
];
const DESKS: Entry[] = [{ id: "k1", slug: "city", data: { Name: "City desk", Slug: "city" } }];

const BRIEFINGS: Entry[] = [
    {
        id: "b1",
        slug: "harbour-levy",
        data: {
            Headline: "The harbour levy, explained",
            Permalink: "harbour-levy",
            Standfirst: "What the council voted for.",
            Story: `## The vote\n\n${STORY}`,
            RunDate: "2026-03-04T12:00:00Z",
            Cover: "https://files.example/harbour.png",
            CoverAlt: "The harbour",
            Keywords: ["ports", "tax"],
            Reporter: REPORTERS[0],
            Desk: DESKS[0],
        },
    },
    { id: "b2", slug: "ferry-fares", data: { Headline: "Ferry fares", Permalink: "ferry-fares", Story: "Short.", RunDate: "2026-02-01T12:00:00Z" } },
];

const BRIEFINGS_COLLECTION = {
    type: "briefing",
    route: "/briefings",
    layout: "article",
    sort: "-RunDate",
    related: "semantic",
    fields: {
        title: "Headline",
        slug: "Permalink",
        summary: "Standfirst",
        body: "Story",
        date: "RunDate",
        image: "Cover",
        imageAlt: "CoverAlt",
        tags: "Keywords",
    },
    references: { Reporter: { collection: "reporters", label: "by" }, Desk: { collection: "desks", label: "in" } },
};

const SETTINGS = {
    Name: "The Harbour Record",
    Url: "https://record.example",
    Collections: {
        briefings: BRIEFINGS_COLLECTION,
        reporters: { type: "reporter", route: "/reporters", fields: { title: "Name", slug: "Slug", body: "Bio" } },
        desks: { type: "desk", route: "/desks", fields: { title: "Name", slug: "Slug" } },
        /*
         * The tenant's own `post`, `author` and `category`, none of them the blueprint's. The blog
         * reads are wrappers over the collection path now, so they read this map. They used to read
         * `config.fields`, which is the image's map and not this tenant's, so every one of them
         * answered "Untitled" with an empty body and no byline.
         */
        post: {
            ...BRIEFINGS_COLLECTION,
            references: { Reporter: { collection: "author", label: "by" }, Desk: { collection: "category", label: "in" } },
        },
        author: { type: "reporter", route: "/reporters", fields: { title: "Name", slug: "Slug", body: "Bio" } },
        category: { type: "desk", route: "/desks", fields: { title: "Name", slug: "Slug" } },
    },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");

        if (url.pathname === "/api/tenants/by-host/record.example") return Response.json({ handle: "record" });
        if (tenant !== "record") return new Response("", { status: 404 });

        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });

        if (url.pathname === "/api/public/site") return paged([{ id: "s", data: SETTINGS }]);
        if (url.pathname === "/api/public/briefing/semantic") {
            return Response.json({
                results: [
                    { contentType: "briefing", slug: "harbour-levy", title: "The harbour levy, explained", score: 0.99 },
                    { contentType: "briefing", slug: "ferry-fares", title: "Ferry fares", score: 0.7123 },
                ],
                count: 2,
                query: url.searchParams.get("q"),
            });
        }

        const byType: Record<string, Entry[]> = { briefing: BRIEFINGS, reporter: REPORTERS, desk: DESKS };
        const [type, slug] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        const entries = byType[type];
        if (!entries) return new Response("", { status: 404 });
        if (slug) {
            const found = entries.find((e) => e.slug === decodeURIComponent(slug));
            return found ? Response.json(found) : new Response("", { status: 404 });
        }
        let listed = entries;
        for (const [key, value] of url.searchParams) {
            const m = key.match(/^filter\[(.+)\]\[eq\]$/);
            if (m) listed = listed.filter((e) => (e.data[m[1]] as { id?: string } | undefined)?.id === value);
        }
        return paged(listed);
    });
}

const base = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

async function site() {
    requestHeaders = new Headers({ host: "record.example" });
    return siteConfig(base);
}

/*
 * Streamed, because these screens are async components and the synchronous renderer refuses one. The
 * empty comments the streaming renderer puts between two adjacent text children are dropped, so an
 * assertion reads the words a visitor sees rather than React's separators.
 */
async function markup(node: Promise<ReactNode> | ReactNode): Promise<string> {
    const stream = await renderToReadableStream(await node);
    await stream.allReady;
    const html = new TextDecoder().decode(await new Response(stream).arrayBuffer());
    return html.split("<!-- -->").join("");
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

describe("a collection asking for the article layout", () => {
    async function briefing(slug: string, related?: { collection: string; via: string } | false) {
        requestHeaders = new Headers({ host: "record.example" });
        const detail = createCollectionDetail(base, "briefings", related === undefined ? {} : { related });
        return markup(detail({ params: Promise.resolve({ slug }) }));
    }

    it("draws the reading column: a back link, a standfirst, a cover and the body", async () => {
        const html = await briefing("harbour-levy");

        expect(html).toContain("The harbour levy, explained");
        expect(html).toContain("What the council voted for.");
        expect(html).toContain('href="/briefings"');
        expect(html).toContain("briefings");
        expect(html).toContain("https://files.example/harbour.png");
        expect(html).toContain("<h2");
        // The shell markup the list layout draws, which this layout does not.
        expect(html).not.toContain('class="shell"');
    });

    it("draws a byline from the collection's first reference, and files the rest after the date", async () => {
        const html = await briefing("harbour-levy");

        expect(html).toContain("Lina Abad");
        expect(html).toContain('href="/reporters/lina"');
        // The monogram beside the byline, which is what the post page has always drawn.
        expect(html).toContain(">LA<");
        expect(html).toContain("City desk");
        expect(html).toContain('href="/desks/city"');
        expect(html.indexOf("Lina Abad")).toBeLessThan(html.indexOf("City desk"));
    });

    it("works out a read time from the body and prints the date and the tags", async () => {
        const html = await briefing("harbour-levy");

        expect(html).toContain("min read");
        expect(html).toContain("3 min read");
        expect(html).toContain("2026-03-04T12:00:00Z");
        expect(html).toContain("ports");
        expect(html).toContain("tax");
    });

    it("draws a band of neighbours under it, with their own hrefs", async () => {
        const html = await briefing("harbour-levy");

        expect(html).toContain("Related");
        expect(html).toContain('href="/briefings/ferry-fares"');
    });

    it("leaves the list layout alone for a collection that did not ask", async () => {
        requestHeaders = new Headers({ host: "record.example" });
        const detail = createCollectionDetail(base, "reporters", { related: false });
        const html = await markup(detail({ params: Promise.resolve({ slug: "lina" }) }));

        expect(html).toContain('class="shell"');
        expect(html).toContain("Lina Abad");
        expect(html).not.toContain("min read");
    });
});

describe("the blog reads, as wrappers over the collection path", () => {
    it("read a replaced post collection through its own field map rather than the image's", async () => {
        const config = await site();
        const post = await getPost(config, "harbour-levy");

        expect(post).not.toBeNull();
        expect(post!.title).toBe("The harbour levy, explained");
        expect(post!.excerpt).toBe("What the council voted for.");
        expect(post!.publishedAt).toBe("2026-03-04T12:00:00Z");
        expect(post!.coverImage).toBe("https://files.example/harbour.png");
        expect(post!.tags).toEqual(["ports", "tax"]);
        expect(post!.author?.name).toBe("Lina Abad");
        expect(post!.category?.name).toBe("City desk");
    });

    it("list through it too, in the order the collection asked the API for", async () => {
        const config = await site();
        const { posts, total } = await listPosts(config);

        expect(posts).toHaveLength(2);
        expect(total).toBe(2);
        expect(posts.map((p) => p.slug)).toEqual(["harbour-levy", "ferry-fares"]);
        expect(posts.every((p) => p.title !== "Untitled")).toBe(true);
    });

    it("map a stored entry the same way", async () => {
        const config = await site();
        expect(toPost(config, BRIEFINGS[0]).title).toBe("The harbour levy, explained");
    });

    it("filter an archive through the post collection's own reference, and still answer null for nobody", async () => {
        const config = await site();
        const filed = await listPostsBy(config, "author", "lina");

        expect(filed).not.toBeNull();
        expect(filed).toHaveLength(1);
        expect(filed![0].slug).toBe("harbour-levy");
        // Null and not an empty list, which is the one thing an archive route needs told apart.
        expect(await listPostsBy(config, "author", "nobody")).toBeNull();
    });
});
