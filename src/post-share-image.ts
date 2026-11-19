import type { PressConfig } from "./config.js";
import { siteBaseUrl } from "./base-path.js";
import { readEnv } from "./env.js";
import type { Item } from "./collections.js";

/*
 * The share image of one post (#263).
 *
 * Served at `/_share/post-image/<slug>`. The path is under `_share` on purpose: the proxy rewrites
 * every other path of a request-time site and stamps `Cache-Control: private, no-store` on the
 * rewrite, and Next keeps that over the route's own header. `_share` is left alone, so the image's
 * cache header reaches the client. The path has no dot for the same reason the proxy leaves dotted
 * paths to the static handler.
 *
 * Importing nothing from next/* keeps this usable from the metadata factories without loading the
 * image renderer.
 */

export const POST_SHARE_IMAGE_ROUTE = "/_share/post-image";

/** The longest slug the route looks up. A longer one is not a slug this site holds. */
export const MAX_POST_SLUG = 200;
const MAX_VERSION = 64;

/** A slug worth a lookup: letters, digits, dot, underscore and hyphen, starting with a letter or digit. */
export function isPostSlug(slug: unknown): slug is string {
    return typeof slug === "string" && slug.length > 0 && slug.length <= MAX_POST_SLUG && /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(slug);
}

/**
 * The address of a post's image on the site's origin. `v` is the entry's updated time, so an edit
 * is a new URL and a crawler or CDN that kept the old card asks again. The route ignores it.
 * Both parts are encoded, and a version that is not short plain text is left off.
 */
export function postShareImageHref(origin: string, slug: string, version?: string): string {
    const query = version && version.length <= MAX_VERSION ? `?${new URLSearchParams({ v: version })}` : "";
    return `${origin}${POST_SHARE_IMAGE_ROUTE}/${encodeURIComponent(slug)}${query}`;
}

/**
 * The `og:image` list for a post: the generated card when a font is configured and the post has a
 * title and a slug, else nothing, which leaves the site's card in place.
 */
export function generatedPostShareImages(config: PressConfig, item: Pick<Item, "slug" | "title" | "content">): string[] | undefined {
    if (!config.site.url || !readEnv().shareImageFont) return undefined;
    if (!item.title.trim() || !isPostSlug(item.slug)) return undefined;
    return [postShareImageHref(siteBaseUrl(config.site.url), item.slug, item.content?.updatedAt)];
}
