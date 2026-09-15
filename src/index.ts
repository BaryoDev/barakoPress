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
export {
    siteConfig,
    siteConfigOrNull,
    showsHoldingPage,
    shareCookieValid,
    signShareCookie,
    shareSecret,
    SHARE_COOKIE,
    SHARE_SESSION_MAX_SECONDS,
    resolveSite,
    tenantFromHeaders,
    applySiteSettings,
    normaliseHost,
    siteHref,
    themeFamilies,
} from "./site.js";
export type { ResolvedTenant } from "./site.js";
export { createSiteLayout, createSiteMetadata } from "./screens/site-layout.js";
export { DEFAULT_THEME, resolveTheme, proseCss, relatedCss, themeVariablesCss } from "./theme.js";
export type {
    PressTheme,
    PressThemeInput,
    ThemeColors,
    ThemeFonts,
    ThemeRadii,
    ThemeLayout,
} from "./theme.js";
export { readingMinutes, initials } from "./reading-time.js";
export type {
    PressConfig,
    PressConfigInput,
    TypeNames,
    FieldMap,
    PageFieldMap,
    RouteMap,
    PageSizes,
    SiteIdentity,
    SitesConfig,
    Holding,
    SiteLink,
    FooterColumn,
    SocialLink,
    TopBar,
} from "./config.js";

export { list, bySlug, bySlugPreview, redeemShareLink, semantic, tenantForHost, cacheTagFor, CmsError } from "./delivery.js";
export type {
    PublicContent,
    Seo,
    ListOptions,
    Paged,
    SemanticHit,
    SemanticResponse,
    ShareRedeemAnswer,
} from "./delivery.js";

export { listRelated, pickRelated } from "./related.js";
export type { RelatedPost } from "./related.js";

export {
    listPosts,
    getPost,
    getPostPreview,
    listPostsBy,
    getTerm,
    listTerms,
    toPost,
    getPage,
    listPages,
    toPage,
    formatDate,
} from "./cms.js";
export type { Post, Ref, Term, Page } from "./cms.js";

export { renderMarkdown, isSafeHref, anchor } from "./markdown.js";
export type { RenderMarkdownOptions } from "./markdown.js";

export { createBlogIndex, Card } from "./screens/blog-index.js";
export {
    createBlogPost,
    createBlogPostPreview,
    createPostMetadata,
    createPostStaticParams,
} from "./screens/blog-post.js";
export { createArchive, createArchiveStaticParams } from "./screens/archive.js";
export { PostView } from "./screens/post-view.js";
export type { PostViewProps } from "./screens/post-view.js";

export {
    defineBlock,
    resolveBlocks,
    readProps,
    blockSchema,
    MAX_BLOCKS,
    MAX_DEPTH,
} from "./blocks/schema.js";
export type {
    BlockDefinition,
    BlockField,
    BlockProps,
    BlockComponentProps,
    BlockRegistry,
    BlockSchema,
    FieldKind,
    ResolvedBlock,
    ResolveOptions,
} from "./blocks/schema.js";
export { createBlockRegistry } from "./blocks/registry.js";
export { builtInBlocks, collectionItems, BLOCK_PROSE_CLASS } from "./blocks/built-in.js";
export type { CollectionItem } from "./blocks/built-in.js";
export { BlockList } from "./blocks/render.js";
export {
    createPage,
    createViewerPage,
    createPageMetadata,
    createPageStaticParams,
    PageView,
} from "./screens/page.js";
export type { PageViewProps } from "./screens/page.js";
export { createBlockSchemaRoute, createBlockSchemaPreflight, parseOrigins } from "./routes/block-schema.js";
export type { BlockSchemaRouteOptions } from "./routes/block-schema.js";

export { createRevalidateRoute } from "./routes/revalidate.js";
export { createSharePage, createShareRedeemRoute, SHARE_INVALID_FRAGMENT } from "./routes/share.js";
export type { SharePageOptions } from "./routes/share.js";
export type { RevalidateOptions } from "./routes/revalidate.js";
export { createFeed } from "./routes/feed.js";
export { createSitemap } from "./routes/sitemap.js";
export { createRobots } from "./routes/robots.js";
