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

export { defineConfig, includesFor } from "./config";
export type {
    PressConfig,
    PressConfigInput,
    TypeNames,
    FieldMap,
    RouteMap,
    PageSizes,
    SiteIdentity,
} from "./config";

export { list, bySlug, bySlugPreview } from "./delivery";
export type { PublicContent, Seo, ListOptions, Paged } from "./delivery";

export {
    listPosts,
    getPost,
    getPostPreview,
    listPostsBy,
    getTerm,
    toPost,
    formatDate,
} from "./cms";
export type { Post, Ref, Term } from "./cms";

export { renderMarkdown, isSafeHref, anchor } from "./markdown";

export { createBlogIndex, Card } from "./screens/blog-index";
export {
    createBlogPost,
    createBlogPostPreview,
    createPostMetadata,
    createPostStaticParams,
} from "./screens/blog-post";
export { createArchive, createArchiveStaticParams } from "./screens/archive";
export { PostView } from "./screens/post-view";

export { createRevalidateRoute } from "./routes/revalidate";
export type { RevalidateOptions } from "./routes/revalidate";
export { createFeed } from "./routes/feed";
export { createSitemap } from "./routes/sitemap";
export { createRobots } from "./routes/robots";
