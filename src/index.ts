/*
 * The barakoPress engine.
 *
 * A site depends on this and re-exports the pieces it wants from its own route files, because
 * Next decides routes by file path and a package cannot create files in someone else's app.
 *
 * Everything that differs between sites is in the config passed to these factories: the content
 * type names, the field map, where the routes are mounted, page sizes, site identity, the cache
 * tag and the backstop. barakoCMS content types are defined at runtime, so a client's posts are
 * as likely to be `article` with a `Headline` as the blueprint's `post` and `Title`. An engine
 * that compiled one shape in would be one blog wearing a package name.
 *
 * A consumer's app/page.tsx:
 *
 *     import { createBlogIndex } from "barakopress";
 *     import { config } from "@/press.config";
 *     export default createBlogIndex(config);
 *     export const revalidate = 300;
 *
 * Route segment config stays in the consumer's file: Next reads it from the file that owns the
 * route and does not reliably follow a re-export, and the caching window is their decision.
 *
 * The screens live in src/screens rather than src/pages because Next claims both `pages` and
 * `app` as router directories, and a `src/pages` inside a transpiled package is read as a second
 * router.
 */

export { defineConfig, includesFor } from "./config.js";
export type {
    PressConfig,
    PressConfigInput,
    TypeNames,
    FieldMap,
    RouteMap,
    PageSizes,
    SiteIdentity,
} from "./config.js";

export { list, bySlug, bySlugPreview } from "./delivery.js";
export type { PublicContent, Seo, ListOptions, Paged } from "./delivery.js";

export {
    listPosts,
    getPost,
    getPostPreview,
    listPostsBy,
    getTerm,
    toPost,
    formatDate,
} from "./cms.js";
export type { Post, Ref, Term } from "./cms.js";

export { renderMarkdown, isSafeHref, anchor } from "./markdown.js";

export { createBlogIndex, Card } from "./screens/blog-index.js";
export {
    createBlogPost,
    createBlogPostPreview,
    createPostMetadata,
    createPostStaticParams,
} from "./screens/blog-post.js";
export { createArchive, createArchiveStaticParams } from "./screens/archive.js";
export { PostView } from "./screens/post-view.js";

export { createRevalidateRoute } from "./routes/revalidate.js";
export type { RevalidateOptions } from "./routes/revalidate.js";
export { createFeed } from "./routes/feed.js";
export { createSitemap } from "./routes/sitemap.js";
export { createRobots } from "./routes/robots.js";
