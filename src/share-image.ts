import type { PressConfig } from "./config.js";
import { readEnv } from "./env.js";

/*
 * The generated share image (#81).
 *
 * The font comes from the consumer: `PRESS_SHARE_IMAGE_FONT` names a font file on the server, read
 * when an image is drawn. This package embeds no font and fetches none at render time. Unset, the
 * route answers 404 and no page advertises it, so a site that configures nothing serves the
 * Open Graph tags it served before. A page with its own SEO image keeps that image.
 *
 * Importing nothing from next/* keeps this usable from the metadata factories without loading the
 * image renderer.
 */

/** Where a consumer mounts the route, and where the tags point. */
export const SHARE_IMAGE_ROUTE = "/share-image";

/** The address of the image for the page at `path`, on the site's own origin. */
export function shareImageHref(origin: string, path: string): string {
    return `${origin}${SHARE_IMAGE_ROUTE}?${new URLSearchParams({ path })}`;
}

/** The `og:image` list for a page with no image of its own: the generated one when a font is configured, else nothing. */
export function generatedShareImages(config: PressConfig, path: string | undefined): string[] | undefined {
    if (path === undefined || !config.site.url || !readEnv().shareImageFont) return undefined;
    return [shareImageHref(config.site.url, path)];
}
