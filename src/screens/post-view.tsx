import type { ReactNode } from "react";
import { POST_COLLECTION, type PressConfig } from "../config.js";
import type { Post } from "../cms.js";
import type { RelatedPost } from "../related.js";
import { ArticleView, type ArticleRelated } from "./article-view.js";
import { itemFromPost } from "./collection.js";

/*
 * The post page, as a wrapper over the article layout (#75).
 *
 * Every byte of markup this produces comes from `ArticleView`, which draws any collection whose
 * `layout` is "article". A post is one: a reading column, a byline, a read time and a band of
 * neighbours are what long-form content wants, not what a blog wants. So the post page stopped being
 * a second screen and became this collection's turn at the general one.
 *
 * It stays exported, and keeps taking a `Post` and a `RelatedPost[]`, because both shipped in 0.4.0
 * and a consumer may be rendering its own post page with them. `test/blog-wrappers.golden.json` holds
 * what the blog rendered before the collection screens existed, and it still passes byte for byte,
 * which is the whole claim this file makes.
 */

export interface PostViewProps {
    config: PressConfig;
    post: Post;
    preview?: boolean;
    /*
     * Three slots, and the reason there are exactly three.
     *
     * A brand mark behind the header is the consumer's, not the engine's: barakocms.com has a bean
     * and a client site has something else or nothing. A post that needs a section the reading
     * column cannot hold needs somewhere wide to put it, and a post that ends in a call to action
     * needs the foot of the column.
     *
     * What these are not is a way to compose a post out of arbitrary sections. Anything that has
     * to sit between two paragraphs of a body belongs to the block model, issue #6, because only
     * the body knows where it goes.
     */
    headerBackdrop?: ReactNode;
    beforeBody?: ReactNode;
    afterBody?: ReactNode;
    /*
     * Computed by `listRelated`, passed in rather than fetched here, because this component also
     * serves the preview screen and a draft has no business warming a shared cache. An empty list
     * renders no band at all: no heading, no empty state. A site whose CMS has no AI module gets
     * an empty list every time and never sees that this feature exists, which is the point.
     */
    related?: RelatedPost[];
}

/** A semantic hit as a band card. The score is what this band has and a plain list of items does not. */
function asBandCard(r: RelatedPost): ArticleRelated {
    return {
        slug: r.slug,
        title: r.title,
        score: r.score,
        ...(r.publishedAt ? { date: r.publishedAt } : {}),
        ...(r.excerpt ? { summary: r.excerpt } : {}),
    };
}

/**
 * @deprecated Since 0.7.0. Use `ItemView` on a collection whose `layout` is "article", or
 * `createCollectionDetail`, which reaches it for you. Removed no earlier than 1.0.0.
 */
export function PostView({ config, post, related = [], ...rest }: PostViewProps) {
    return (
        <ArticleView
            config={config}
            item={itemFromPost(config, post)}
            related={related.map(asBandCard)}
            {...rest}
        />
    );
}
