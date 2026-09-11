import { defineConfig } from "barakopress";

/*
 * This site's configuration, and the one file a new site edits.
 *
 * Identity is written here as literals, not read from process.env, and that is deliberate. The
 * index, the feed, the sitemap and robots are prerendered, so anything this module reads from the
 * environment is baked at BUILD time, not at start. An image built without SITE_NAME, which is
 * how the Dockerfile builds it so the image is not tied to one deployment, then ships the
 * fallback in its masthead until something revalidates it. A client site would carry the vendor's
 * name on the day it was handed over.
 *
 * So: a per-site value goes here, in the file a site owns. Only things that genuinely differ per
 * environment rather than per site (where the CMS is, the webhook secret) come from the
 * environment, and neither of those is rendered.
 *
 * A site using the `blog` blueprint unchanged needs nothing but its identity. Everything else
 * defaults to what `POST /api/content-types/blueprints/blog` creates: the types post, author and
 * category, the PascalCase field names, and routes at /blog, /authors and /categories.
 */
export const config = defineConfig({
  site: {
    name: "barakoPress",
    tagline: "A blog on barakoCMS",
    url: "http://localhost:3000",
  },
});
