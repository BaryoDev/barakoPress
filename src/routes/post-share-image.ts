import type { PressConfig } from "../config.js";
import { POST_COLLECTION } from "../config.js";
import { postFromItem } from "../cms.js";
import { getItem } from "../collections.js";
import { readEnv } from "../env.js";
import { isPostSlug } from "../post-share-image.js";
import { siteConfigOrNull } from "../site.js";
import { drawShareCard, loadFont } from "./share-image.js";

/*
 * The share image of one post: its title and category on the site's card (#263).
 *
 * The post is read by collection and slug through `getItem`, the read the post page makes, so a post
 * the page cannot show (a draft, an unpublished or deleted entry) is not drawn. Those answer 404, not
 * the site card: the page never advertises this URL for them, so a 404 is the honest answer and no
 * cache keeps a card for a post that is not there. A CMS failure answers 502 with no-store, so an
 * outage is not cached as "no image".
 *
 * The slug is the only input. It is checked against a short pattern before any lookup, and the query
 * is never read, so nothing a caller sends can become text on the card.
 */
export function createPostShareImage(base: PressConfig) {
    return async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
        const notFound = () => new Response("Not found", { status: 404 });
        const fontPath = readEnv().shareImageFont;
        if (!fontPath) return notFound();
        const { slug } = await ctx.params;
        if (!isPostSlug(slug)) return notFound();
        const config = await siteConfigOrNull(base);
        if (!config || config.holding) return notFound();

        let item;
        try {
            item = await getItem(config, POST_COLLECTION, slug);
        } catch {
            console.warn("post share image: the post could not be read");
            return new Response("Bad gateway", { status: 502, headers: { "cache-control": "no-store" } });
        }
        if (!item || !item.title.trim()) return notFound();

        let font: ArrayBuffer;
        try {
            font = await loadFont(fontPath);
        } catch {
            console.warn("post share image: the font named by PRESS_SHARE_IMAGE_FONT could not be read");
            return notFound();
        }
        return drawShareCard(config, { title: item.title, kicker: postFromItem(config, item).category?.name }, font);
    };
}
