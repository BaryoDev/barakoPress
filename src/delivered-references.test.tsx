import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * What barakoCMS 4.7 (delivery contract 7) leaves out of `data`: a reference to an entry delivery
 * would not serve (a draft, one that is not Public, one deleted, one in another tenant). A single
 * reference loses its key, and a list keeps only the ids that are served. The type of a slug field
 * that is not Public has no slug on delivery at all, so neither the member nor the field is there.
 *
 * Every case here draws without the missing value: no crash, no "undefined" in the markup, and no
 * link to a page that is not there.
 */

vi.mock("next/headers", () => ({
    headers: async () => {
        throw new Error("headers() was read");
    },
    cookies: async () => ({ get: () => undefined }),
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
const { toItem } = await import("./collections.js");
const { Card, ItemView } = await import("./screens/collection.js");
const { itemScope } = await import("./blocks/bind.js");
const { BindingSource, bindText } = await import("./blocks/bindings.js");
const { createBlogIndex, createBlogPost } = await import("./index.js");
import type { PublicContent } from "./delivery.js";

const CMS = "http://cms.test";
const ANA = { id: "s1", slug: "ana", data: { Name: "Ana", Slug: "ana" } };

const config = defineConfig({
    site: { name: "Test", url: "https://test.example" },
    cmsUrl: CMS,
    collections: {
        event: {
            type: "event",
            route: "/events",
            layout: "article",
            fields: { title: "EventName", slug: "Slug", body: "Body" },
            references: { Host: { collection: "speaker", label: "hosted by" }, Speakers: { collection: "speaker" } },
        },
        speaker: { type: "speaker", route: "/speakers", fields: { title: "Name", slug: "Slug" } },
    },
});

const entry = (data: Record<string, unknown>, extra: Partial<PublicContent> = {}): PublicContent => ({
    id: "e1",
    slug: "harbour-night",
    contentType: "event",
    data: { EventName: "Harbour night", Slug: "harbour-night", Body: "Boats and lanterns.", ...data },
    ...extra,
});

beforeEach(() => forgetCachedReads());
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a single reference delivery left out", () => {
    it("reads as no reference", () => {
        const item = toItem(config, "event", entry({ Speakers: [ANA] }));

        expect(item.refs.Host).toBeUndefined();
        expect(item.refs.Speakers?.slug).toBe("ana");
    });

    it("draws a card and an item page without it", () => {
        const item = toItem(config, "event", entry({ Speakers: [ANA] }));
        const card = renderToStaticMarkup(<Card config={config} item={item} />);
        const page = renderToStaticMarkup(<ItemView config={config} item={item} />);

        for (const html of [card, page]) {
            expect(html).toContain("Harbour night");
            expect(html).toContain(`href="/speakers/ana"`);
            expect(html).not.toContain("hosted by");
            expect(html).not.toContain("undefined");
        }
        expect(page).toContain("Boats and lanterns.");
    });

    it("binds to the placeholder's fallback, not to the word undefined", async () => {
        const item = toItem(config, "event", entry({}));
        const source = new BindingSource({ item: () => itemScope(config, item) }, { locale: "en-US" });

        const { text } = await bindText("Host: {{item.Host.name ?? TBA}}", source);
        expect(text).toBe("Host: TBA");
    });
});

describe("a list of references with fewer ids than were stored", () => {
    it("links the ones that came back, and nothing for the rest", () => {
        const item = toItem(config, "event", entry({ Speakers: [ANA] }));
        const html = renderToStaticMarkup(<Card config={config} item={item} />);

        expect(item.refLists?.Speakers).toHaveLength(1);
        expect(html.match(/href="\/speakers\//g)).toHaveLength(1);
        expect(html).not.toContain("undefined");
    });
});

describe("an item of a type with no slug on delivery", () => {
    it("draws its page with no link to itself", () => {
        const item = toItem(config, "event", entry({ Slug: undefined }, { slug: null }));
        const html = renderToStaticMarkup(<ItemView config={config} item={item} />);

        expect(item.slug).toBe("");
        expect(html).toContain("Harbour night");
        expect(html).not.toContain(`href="/events/"`);
        expect(html).not.toContain("undefined");
    });
});

describe("a blog post whose author is a draft", () => {
    const blog = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS });
    const POST = {
        id: "p1",
        slug: "hello",
        data: { Title: "Hello", Slug: "hello", Body: "A first post.", PublishedAt: "2026-10-01T00:00:00Z" },
    };

    beforeEach(() => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const path = new URL(String(input)).pathname;
                if (path === "/api/public/post/hello") return Response.json(POST);
                const items = path === "/api/public/post" ? [POST] : [];
                return Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
            }),
        );
    });

    it("draws the post and the index with no byline", async () => {
        const post = renderToStaticMarkup(await createBlogPost(blog)({ params: Promise.resolve({ slug: "hello" }) }));
        const index = renderToStaticMarkup(await createBlogIndex(blog)({ searchParams: Promise.resolve({}) }));

        expect(post).toContain("A first post.");
        expect(index).toContain(`href="/blog/hello"`);
        for (const html of [post, index]) {
            expect(html).toContain("Hello");
            expect(html).not.toContain(`href="/authors/`);
            expect(html).not.toContain("undefined");
        }
    });
});
