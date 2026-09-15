import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * What the blog-shaped factories produce, pinned to a file.
 *
 * test/blog-wrappers.golden.json was written by this test against the engine before collections
 * existed, when these factories were the only way to render a list or a detail page. They are thin
 * wrappers over the collection screens now, and an existing site changes nothing only if every byte
 * of markup, feed, sitemap, metadata and every request they make stays what it was. So this compares
 * all of it, for the blog blueprint, for a model that is not the blueprint, and for a tenant.
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

const press = await import("./index.js");
const { forgetCachedReads } = await import("./delivery.js");

const CMS = "http://cms.test";

const ada = { id: "a1", slug: "ada", data: { Name: "Ada Lovelace", Slug: "ada", Bio: "Wrote the *first* program.", Website: "https://ada.example" } };
const grace = { id: "a2", slug: "grace", data: { Name: "Grace Hopper", Slug: "grace" } };
const notes = { id: "c1", slug: "notes", data: { Name: "Notes", Slug: "notes", Description: "Short ones." } };

const POSTS = [
    {
        id: "p1",
        slug: "first-post",
        createdAt: "2026-01-02T12:00:00Z",
        data: {
            Title: "First post",
            Slug: "first-post",
            Excerpt: "The first one.",
            Body: "## Hello\n\nSome *text* and a [link](https://example.com).",
            PublishedAt: "2026-03-04T12:00:00Z",
            CoverImage: "https://files.example/cover.png",
            CoverImageAlt: "A cover",
            Featured: true,
            Tags: ["one", "two"],
            Author: ada,
            Category: notes,
        },
        seo: { title: "First post SEO", description: "Described", canonicalUrl: "https://blog.example/canonical", imageUrl: "https://files.example/seo.png" },
    },
    {
        id: "p2",
        slug: "second-post",
        createdAt: "2026-02-02T12:00:00Z",
        data: { Title: "Second post", Slug: "second-post", Body: "Plain.", PublishedAt: "2026-03-01T12:00:00Z", Category: notes, Author: grace },
        seo: { noIndex: true },
    },
    { id: "p3", slug: "third", createdAt: "2026-02-10T12:00:00Z", data: { Title: "Third", Slug: "third", Body: "No date field." } },
];

const ARTICLES = [
    {
        id: "r1",
        slug: "ci-article",
        data: { Headline: "An article, not a post", Permalink: "ci-article", Standfirst: "Different names.", Story: "It *renders*.", RunDate: "2026-01-01T12:00:00Z" },
    },
];

const TENANT_POSTS: Record<string, unknown[]> = {
    baryo: [{ id: "b1", slug: "shipping-notes", data: { Title: "Shipping notes", Slug: "shipping-notes", Body: "x", PublishedAt: "2026-04-01T12:00:00Z" } }],
};

type Call = { path: string; tenant: string | null; tags: string[]; cache?: string };
let calls: Call[] = [];

const paged = (items: unknown[]) =>
    Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push({ path: url.pathname + url.search, tenant, tags: init?.next?.tags ?? [], cache: init?.cache });

        if (url.pathname === "/api/tenants/by-host/baryo.dev") return Response.json({ handle: "baryo" });
        if (tenant) {
            if (url.pathname === "/api/public/site") return paged([{ id: "s", data: { Name: "BaryoDev", Url: "https://baryo.dev" } }]);
            if (url.pathname === "/api/public/post") return paged(TENANT_POSTS[tenant] ?? []);
            return new Response("", { status: 404 });
        }

        const byType: Record<string, unknown[]> = { post: POSTS, author: [ada, grace], category: [notes], article: ARTICLES };
        const parts = url.pathname.replace(/^\/api\/public\//, "").split("/");
        const items = byType[parts[0]];
        if (!items) return new Response("", { status: 404 });
        if (parts[1] === "semantic") {
            return Response.json({
                results: [
                    { contentType: parts[0], slug: "first-post", title: "First post", score: 0.99 },
                    { contentType: parts[0], slug: "second-post", title: "Second post", score: 0.81234 },
                    { contentType: parts[0], title: "No slug", score: 0.7 },
                ],
                count: 3,
                query: url.searchParams.get("q"),
            });
        }
        if (parts[1]) {
            const found = (items as { slug: string }[]).find((i) => i.slug === decodeURIComponent(parts[1]));
            return found ? Response.json(found) : new Response("", { status: 404 });
        }
        let listed = items as { data: Record<string, unknown> }[];
        for (const [key, value] of url.searchParams) {
            const m = key.match(/^filter\[(.+)\]\[eq\]$/);
            if (m) listed = listed.filter((i) => (i.data[m[1]] as { id?: string } | undefined)?.id === value);
        }
        return paged(listed);
    });
}

async function settle<T>(run: () => Promise<T>): Promise<T | string> {
    try {
        return await run();
    } catch (e) {
        return (e as Error).message;
    }
}

const html = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("the blog wrappers", () => {
    it("render, read and link exactly as before collections", async () => {
        const blueprint = press.defineConfig({ site: { name: "Blog", tagline: "Things", url: "https://blog.example" }, cmsUrl: CMS });
        const client = press.defineConfig({
            types: { post: "article", author: undefined, category: undefined, page: "landing" },
            fields: {
                title: "Headline",
                slug: "Permalink",
                excerpt: "Standfirst",
                body: "Story",
                publishedAt: "RunDate",
                coverImage: undefined,
                coverImageAlt: undefined,
                featured: undefined,
                tags: undefined,
                author: undefined,
                category: undefined,
            },
            routes: { post: "/writing" },
            site: { name: "CI", url: "https://ci.example" },
            cmsUrl: CMS,
        });
        const tenanted = press.defineConfig({ sites: {}, cmsUrl: CMS });

        const results: Record<string, unknown> = {};
        async function record(name: string, run: () => Promise<unknown>) {
            calls = [];
            forgetCachedReads();
            const output = await settle(run);
            // The requests as a set: what is asked, with which tenant, tag and cache mode. Two identical
            // reads in one render cost one read under Next's data cache, so the count is not behaviour.
            const asked = [...new Set(calls.map((c) => JSON.stringify(c)))].sort();
            results[name] = { output, calls: asked.map((c) => JSON.parse(c) as Call) };
        }

        for (const [label, cfg] of [["blueprint", blueprint], ["client", client]] as const) {
            const slug = label === "blueprint" ? "first-post" : "ci-article";
            const params = Promise.resolve({ slug });
            await record(`${label}: index`, () => html(press.createBlogIndex(cfg)()));
            await record(`${label}: post`, () => html(press.createBlogPost(cfg)({ params })));
            await record(`${label}: post preview`, () =>
                html(press.createBlogPostPreview(cfg)({ params, searchParams: Promise.resolve({ preview: "tok en" }) })),
            );
            await record(`${label}: post preview without a token`, () =>
                html(press.createBlogPostPreview(cfg)({ params, searchParams: Promise.resolve({}) })),
            );
            await record(`${label}: missing post`, () => html(press.createBlogPost(cfg)({ params: Promise.resolve({ slug: "nope" }) })));
            await record(`${label}: post metadata`, () => press.createPostMetadata(cfg)({ params }));
            await record(`${label}: missing post metadata`, () => press.createPostMetadata(cfg)({ params: Promise.resolve({ slug: "nope" }) }));
            await record(`${label}: post static params`, () => press.createPostStaticParams(cfg)());
            await record(`${label}: feed`, async () => {
                const res = await press.createFeed(cfg)();
                return { status: res.status, headers: [...res.headers], body: await res.text() };
            });
            await record(`${label}: sitemap`, async () => JSON.parse(JSON.stringify(await press.createSitemap(cfg)())));
            await record(`${label}: list posts`, () => press.listPosts(cfg));
            await record(`${label}: get post`, () => press.getPost(cfg, slug));
            await record(`${label}: related`, async () => {
                const post = await press.getPost(cfg, slug);
                return post ? press.listRelated(cfg, post) : null;
            });
            for (const which of ["post", "author", "category"] as const) {
                await record(`${label}: collection block items ${which}`, () => press.collectionItems(cfg, which, 3));
            }
            for (const which of ["author", "category"] as const) {
                const term = which === "author" ? "ada" : "notes";
                await record(`${label}: archive ${which}`, () => html(press.createArchive(cfg, which)({ params: Promise.resolve({ slug: term }) })));
                await record(`${label}: archive ${which} unknown`, () =>
                    html(press.createArchive(cfg, which)({ params: Promise.resolve({ slug: "nobody" }) })),
                );
                await record(`${label}: archive ${which} static params`, () => press.createArchiveStaticParams(cfg, which)());
                await record(`${label}: posts by ${which}`, () => press.listPostsBy(cfg, which, term));
                await record(`${label}: term ${which}`, () => press.getTerm(cfg, which, term));
                await record(`${label}: terms ${which}`, () => press.listTerms(cfg, which, 5));
            }
            await record(`${label}: cards`, async () => {
                const { posts } = await press.listPosts(cfg);
                return posts.map((post, i) => renderToStaticMarkup(<press.Card config={cfg} post={post} featured={i === 0} />));
            });
        }

        requestHeaders = new Headers({ host: "baryo.dev" });
        await record("tenant: index", () => html(press.createBlogIndex(tenanted)()));
        await record("tenant: feed", async () => (await press.createFeed(tenanted)()).text());
        await record("tenant: sitemap", async () => JSON.parse(JSON.stringify(await press.createSitemap(tenanted)())));

        expect(Object.keys(results)).toHaveLength(2 * 29 + 3);
        await expect(`${JSON.stringify(results, null, 2)}\n`).toMatchFileSnapshot("../test/blog-wrappers.golden.json");
    });
});
