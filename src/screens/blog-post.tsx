import { AUTHOR_COLLECTION, CATEGORY_COLLECTION, POST_COLLECTION, type PressConfig } from "../config.js";
import { toPost, type Post, type Ref } from "../cms.js";
import { collectionOf, type Item } from "../collections.js";
import { listRelated } from "../related.js";
import {
    createCollectionDetail,
    createCollectionMetadata,
    createCollectionStaticParams,
    type ItemViewProps,
} from "./collection.js";
import { PostView } from "./post-view.js";

/*
 * The post page, in two shapes, over the post collection's detail page.
 *
 * `createBlogPost` reads only `params`, so it can be prerendered and works under
 * `output: "export"`. `createBlogPostPreview` also reads `searchParams` for a preview token,
 * which forces dynamic rendering: a static export refuses it outright with "couldn't be rendered
 * statically because it used searchParams". A static site takes the first and gives up draft
 * preview, which is the honest trade and the reason these are two exports rather than a flag.
 *
 * Both render `PostView` rather than the generic item view, since a post has a reading column, a byline
 * and a Related band that a department does not.
 */

/*
 * The item as a post, for a tenant that replaced the `post` collection in its settings (#44).
 *
 * `toPost` reads the entry through `fields`, which is the image's map and not that tenant's. The
 * item was already read through the collection's own map, so a replaced collection is mapped from
 * the item and the blueprint keeps the path it always took, byte for byte.
 */
function postFromItem(config: PressConfig, item: Item): Post {
    const col = collectionOf(config, POST_COLLECTION);
    const refIn = (target: string): Ref | undefined => {
        const field = Object.entries(col?.references ?? {}).find(([, ref]) => ref.collection === target)?.[0];
        return field ? item.refs[field] : undefined;
    };
    return {
        id: item.id,
        slug: item.slug,
        title: item.title,
        excerpt: item.summary,
        body: item.body,
        publishedAt: item.date,
        coverImage: item.image,
        coverImageAlt: item.imageAlt,
        featured: item.featured,
        tags: item.tags,
        author: refIn(AUTHOR_COLLECTION),
        category: refIn(CATEGORY_COLLECTION),
        seo: item.seo,
    };
}

async function PostPage({ config, item, preview }: ItemViewProps) {
    const col = collectionOf(config, POST_COLLECTION);
    const post = col && col.type !== config.types.post ? postFromItem(config, item) : toPost(config, item.content);
    // Related reads published content, so it is the same cached call in a preview. A preview that
    // hides the band would not be showing the editor the page they are about to publish.
    const related = await listRelated(config, post);
    return <PostView config={config} post={post} preview={preview} related={related} />;
}

export function createBlogPost(base: PressConfig) {
    return createCollectionDetail(base, POST_COLLECTION, { view: PostPage, related: false });
}

export function createBlogPostPreview(base: PressConfig) {
    return createCollectionDetail(base, POST_COLLECTION, { view: PostPage, related: false, preview: true });
}

export function createPostMetadata(base: PressConfig) {
    return createCollectionMetadata(base, POST_COLLECTION);
}

/*
 * Slugs for a static export, paged to the end rather than to one hardcoded limit.
 *
 * Every consumer of an export-mode site needs this, and every one that hand-writes it caps the
 * page size and silently drops the posts past it. Doing it once here is the difference between an
 * engine and a snippet in a README.
 */
export function createPostStaticParams(config: PressConfig) {
    return createCollectionStaticParams(config, POST_COLLECTION);
}
