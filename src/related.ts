import type { PressConfig } from "./config.js";
import { bySlug, semantic, type SemanticHit } from "./delivery.js";
import { toPost, type Post } from "./cms.js";
import { listReferencing, type Item } from "./collections.js";

/*
 * Related posts, computed rather than curated.
 *
 * Nobody sorts posts into buckets. The query is the current post's title, the ranking is cosine
 * similarity done by the CMS, and the answer changes when the content changes because there is no
 * list here to maintain.
 *
 * The whole thing degrades to nothing. `semantic` already swallows the 404 a CMS without the AI
 * module answers and the empty list an unenabled one answers, so a site that never installed the
 * module gets an empty array and the screen renders no band at all. That is what makes this safe
 * to ship before the module is turned on anywhere, which is the case on barakocms.com today.
 */

export interface RelatedPost {
    slug: string;
    title: string;
    /** Cosine similarity as the API rounded it. Shown, because a computed list should say so. */
    score: number;
    publishedAt?: string;
    excerpt?: string;
}

/*
 * Ask for more than we render.
 *
 * The post being read is its own closest match and comes back first almost every time, so asking
 * for three and dropping one leaves two. A hit with no slug is dropped as well, since there is
 * nothing to link it to, and a slug can go missing between the vector being stored and now.
 */
const OVERFETCH = 2;

/**
 * Which hits become cards. Separate from the fetch so the rules can be tested without a CMS, and
 * because these three lines are the whole behaviour worth getting right.
 */
export function pickRelated(
    hits: SemanticHit[],
    currentSlug: string,
    limit: number,
): { slug: string; title: string; score: number }[] {
    return hits
        .filter((h): h is SemanticHit & { slug: string } => Boolean(h.slug))
        .filter((h) => h.slug !== currentSlug)
        .slice(0, limit)
        .map((h) => ({ slug: h.slug, title: h.title, score: h.score }));
}

/**
 * Two lists share this name. Given a post, the posts closest to it by semantic search. Given a
 * collection key, an item and the reference field `via`, the items of that collection pointing at the
 * item, such as a department's doctors.
 */
export function listRelated(config: PressConfig, post: Post, limit?: number): Promise<RelatedPost[]>;
export function listRelated(
    config: PressConfig,
    collection: string,
    item: Pick<Item, "id">,
    options: { via: string; pageSize?: number },
): Promise<Item[]>;
export async function listRelated(
    config: PressConfig,
    target: Post | string,
    second?: number | Pick<Item, "id">,
    options?: { via: string; pageSize?: number },
): Promise<RelatedPost[] | Item[]> {
    if (typeof target === "string") {
        if (!second || typeof second !== "object" || !options) return [];
        return listReferencing(config, target, second.id, options.via, options.pageSize);
    }
    return relatedPosts(config, target, typeof second === "number" ? second : 3);
}

async function relatedPosts(config: PressConfig, post: Post, limit: number): Promise<RelatedPost[]> {
    const hits = await semantic(config, config.types.post, post.title, limit + OVERFETCH);
    const candidates = pickRelated(hits, post.slug, limit);

    if (candidates.length === 0) return [];

    /*
     * The endpoint returns a slug, a title and a score, so the date and the blurb are a second
     * read each. They are cached and tagged like every other read, so this costs three reads once
     * per publish rather than three per page view, and a read that fails leaves the card with the
     * title and score it already had rather than dropping it.
     */
    return Promise.all(
        candidates.map(async (h): Promise<RelatedPost> => {
            const base = h;
            try {
                const content = await bySlug(config, config.types.post, h.slug);
                if (!content) return base;
                const full = toPost(config, content);
                return { ...base, publishedAt: full.publishedAt, excerpt: full.excerpt };
            } catch {
                return base;
            }
        }),
    );
}
