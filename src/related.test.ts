import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "./config.js";
import { listRelated, pickRelated } from "./related.js";
import type { Post } from "./cms.js";
import { forgetCachedReads, type SemanticHit } from "./delivery.js";

const hit = (slug: string | undefined, score: number): SemanticHit => ({
    contentType: "post",
    slug,
    title: slug ? `About ${slug}` : "Untitled",
    score,
});

describe("pickRelated", () => {
    it("drops the post being read", () => {
        // The post is its own closest match and comes back first almost every time, which is why
        // the fetch asks for more than it renders.
        const picked = pickRelated([hit("here", 0.99), hit("a", 0.88), hit("b", 0.81)], "here", 3);

        expect(picked).toHaveLength(2);
        expect(picked.map((p) => p.slug)).toEqual(["a", "b"]);
    });

    it("drops a hit with no slug, because there is nothing to link it to", () => {
        const picked = pickRelated([hit(undefined, 0.9), hit("a", 0.88)], "here", 3);

        expect(picked).toHaveLength(1);
        expect(picked[0].slug).toBe("a");
    });

    it("renders no more than the limit", () => {
        const picked = pickRelated([hit("a", 0.9), hit("b", 0.8), hit("c", 0.7), hit("d", 0.6)], "here", 3);

        expect(picked).toHaveLength(3);
        expect(picked.map((p) => p.slug)).toEqual(["a", "b", "c"]);
    });

    it("keeps the order the API ranked them in", () => {
        // The API sorts by score descending. Re-sorting here would be a second opinion on a
        // ranking this package did not compute.
        const picked = pickRelated([hit("a", 0.91), hit("b", 0.9), hit("c", 0.89)], "here", 3);

        expect(picked.map((p) => p.score)).toEqual([0.91, 0.9, 0.89]);
    });

    it("gives back nothing when the module answered with nothing", () => {
        expect(pickRelated([], "here", 3)).toEqual([]);
    });
});

/*
 * A tenant that replaced the `post` collection (#78).
 *
 * The band used to ask `types.post` for its similarity search, so a school whose news lives in
 * `article` was shown the blueprint type's neighbours. Both types answer here, with different
 * entries, so the wrong read is visible in the result rather than only in the call list.
 */
describe("related posts on a tenant that replaced the post collection", () => {
    const config = defineConfig({
        site: { name: "Baryo High", url: "https://school.example" },
        cmsUrl: "http://cms.invalid",
        collections: {
            post: {
                type: "article",
                route: "/news",
                fields: { title: "Headline", slug: "Permalink", summary: "Standfirst", body: "Story", date: "RunDate" },
                feed: true,
            },
        },
    });

    const ARTICLES: Record<string, unknown> = {
        "enrolment-open": {
            id: "a1",
            slug: "enrolment-open",
            data: {
                Headline: "Enrolment is open",
                Permalink: "enrolment-open",
                Standfirst: "The office is open from eight.",
                RunDate: "2026-03-04T12:00:00Z",
            },
        },
        "new-canteen": {
            id: "a2",
            slug: "new-canteen",
            data: { Headline: "A new canteen", Permalink: "new-canteen", Standfirst: "Lunch moves.", RunDate: "2026-02-01T12:00:00Z" },
        },
    };

    const calls: string[] = [];

    beforeEach(() => {
        calls.length = 0;
        forgetCachedReads();
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = new URL(String(input));
                calls.push(url.pathname);
                if (url.pathname === "/api/public/article/semantic") {
                    return Response.json({
                        results: [
                            { contentType: "article", slug: "here", title: "Here", score: 0.99 },
                            { contentType: "article", slug: "enrolment-open", title: "Enrolment is open", score: 0.88 },
                            { contentType: "article", slug: "new-canteen", title: "A new canteen", score: 0.81 },
                        ],
                        count: 3,
                        query: "x",
                    });
                }
                if (url.pathname === "/api/public/post/semantic") {
                    return Response.json({
                        results: [{ contentType: "post", slug: "blueprint-neighbour", title: "From the blueprint type", score: 0.95 }],
                        count: 1,
                        query: "x",
                    });
                }
                const one = url.pathname.match(/^\/api\/public\/article\/(.+)$/);
                if (one && Object.hasOwn(ARTICLES, one[1])) return Response.json(ARTICLES[one[1]]);
                return new Response("", { status: 404 });
            }),
        );
    });

    afterEach(() => vi.unstubAllGlobals());

    it("lists the tenant's own entries, read through the collection's field map", async () => {
        const post = { id: "a0", slug: "here", title: "Here", body: "" } as Post;

        const related = await listRelated(config, post);

        expect(related).toHaveLength(2);
        expect(related.map((r) => r.slug)).toEqual(["enrolment-open", "new-canteen"]);
        expect(related.map((r) => r.title)).not.toContain("From the blueprint type");
        expect(related[0].excerpt).toBe("The office is open from eight.");
        expect(related[0].publishedAt).toBe("2026-03-04T12:00:00Z");
    });

    it("sends no read to the blueprint's type", async () => {
        const post = { id: "a0", slug: "here", title: "Here", body: "" } as Post;

        await listRelated(config, post);

        expect(calls.length).toBeGreaterThan(0);
        expect(calls.filter((c) => c.startsWith("/api/public/post"))).toEqual([]);
    });
});
