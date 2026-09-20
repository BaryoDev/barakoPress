import { POST_COLLECTION, type PressConfig } from "./config.js";
import { semantic, type SemanticHit } from "./delivery.js";
import type { Post } from "./cms.js";
import { collectionOf, getItem, listReferencing, type Item } from "./collections.js";

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
 *
 * @deprecated Since 0.7.0. Use `listRelatedItems(config, collection, item)` for the nearest items of a
 * collection by meaning, or `listCollection(config, key, { filter })` for the items pointing at one.
 * Removed no earlier than 1.0.0.
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

/**
 * The items of a collection closest to one of its items by meaning, as items of that same collection.
 *
 * The same idea as the post band, for any collection whose `related` is "semantic": an agency's case
 * studies want the nearest case study the way a post wants the nearest post. It degrades to nothing
 * for the same reason `relatedPosts` does, since `semantic` swallows the 404 a CMS with no AI module
 * answers and the empty list an unenabled one gives, so a site without the module renders no band.
 *
 * Full items rather than hits, because the item card is what draws them and it needs the fields the
 * search does not return. Each read is cached and tagged like every other, and one that fails drops
 * that card rather than the band.
 */
export async function listRelatedItems(
    config: PressConfig,
    collection: string,
    item: Pick<Item, "slug" | "title">,
    limit = 3,
): Promise<Item[]> {
    const col = collectionOf(config, collection);
    if (!col || !item.title) return [];
    const hits = await semantic(config, col.type, item.title, limit + OVERFETCH);
    const picked = pickRelated(hits, item.slug, limit);
    const found = await Promise.all(
        picked.map(async (h) => {
            try {
                return await getItem(config, collection, h.slug);
            } catch {
                return null;
            }
        }),
    );
    return found.filter((i): i is Item => i !== null);
}

async function relatedPosts(config: PressConfig, post: Post, limit: number): Promise<RelatedPost[]> {
    /*
     * The post collection's type, which is the tenant's own when it replaced `post` (#78). Reading
     * `types.post` here asked the blueprint's type on a school whose news lives in `article`, so the
     * band rendered, and rendered another collection's neighbours.
     */
    const type = collectionOf(config, POST_COLLECTION)?.type ?? config.types.post;
    const hits = await semantic(config, type, post.title, limit + OVERFETCH);
    const candidates = pickRelated(hits, post.slug, limit);

    if (candidates.length === 0) return [];

    /*
     * The endpoint returns a slug, a title and a score, so the date and the blurb are a second
     * read each. They go through the collection, so they are read under the names the tenant gave
     * them. They are cached and tagged like every other read, so this costs three reads once per
     * publish rather than three per page view, and a read that fails leaves the card with the title
     * and score it already had rather than dropping it.
     */
    return Promise.all(
        candidates.map(async (base): Promise<RelatedPost> => {
            try {
                const item = await getItem(config, POST_COLLECTION, base.slug);
                return item ? { ...base, publishedAt: item.date, excerpt: item.summary } : base;
            } catch {
                return base;
            }
        }),
    );
}
