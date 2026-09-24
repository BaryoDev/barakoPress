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

/*
 * `readEnv` and the two resolvers over it, `cmsUrlFor` and `pinnedTenant`, are deliberately not
 * exported here. Nothing outside src/ uses them, and this is a published package: exporting one
 * ahead of a caller means whoever removes it later is making a breaking change for whoever picked
 * it up in between. The pull request that first needs one adds the line, where the reason is in
 * the diff beside the use.
 */
export {
    defineConfig,
    includesFor,
    DEFAULT_LABELS,
    POST_COLLECTION,
    AUTHOR_COLLECTION,
    CATEGORY_COLLECTION,
    SETTINGS_TYPE,
    EMBED_HOSTS,
    TREE_LIMIT,
    TREE_DISCLOSURES,
    TREE_PAGERS,
    TREE_SEARCHES,
    TREE_SIDEBARS,
    TREE_SWITCHERS,
    hasFeed,
} from "./config.js";
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
    getGlobals,
} from "./site.js";
export {
    allowedFontOrigins,
    fontLinks,
    fontStylesheetHref,
    themeFamilies,
    FONT_ROLES,
    GOOGLE_FONTS_ORIGIN,
    GOOGLE_FONTS_FILES_ORIGIN,
} from "./fonts.js";
export type { FontHead } from "./fonts.js";
export type { ResolvedTenant } from "./site.js";
export { createSiteLayout, createSiteMetadata } from "./screens/site-layout.js";
export { DEFAULT_THEME, resolveTheme, proseCss, relatedCss, themeVariablesCss } from "./theme.js";
export type {
    PressTheme,
    PressThemeInput,
    SuppliedAsset,
    ThemeColors,
    FontRole,
    ThemeFontSources,
    ThemeFonts,
    ThemeRadii,
    ThemeLayout,
    ThemeSpace,
    ThemeText,
    ThemeTone,
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
    Region,
    SiteRegions,
    SiteLink,
    HeaderAction,
    HeaderActionVariant,
    FooterColumn,
    SocialLink,
    TopBar,
    CollectionConfig,
    CollectionIndexCopy,
    CollectionFields,
    CollectionReference,
    FieldNames,
    OptionStyle,
    Labels,
    Home,
    CollectionTree,
    TreeProduct,
    TreeIcons,
    TreeVariant,
} from "./config.js";

export {
    list,
    bySlug,
    bySlugPreview,
    redeemShareLink,
    search,
    semantic,
    tenantForHost,
    cacheTagFor,
    CmsError,
    PAGES_CONTRACT,
    speaksPagesContract,
} from "./delivery.js";
export type {
    PublicContent,
    Seo,
    ListOptions,
    Paged,
    SearchResponse,
    SemanticHit,
    SemanticResponse,
    ShareRedeemAnswer,
    ShareRedeemCaller,
} from "./delivery.js";

export { listRelated, listRelatedItems, pickRelated } from "./related.js";
export type { RelatedPost } from "./related.js";

export {
    listPosts,
    getPost,
    getPostPreview,
    listPostsBy,
    getTerm,
    listTerms,
    toPost,
    postFromItem,
    getPage,
    listPages,
    toPage,
    formatDate,
    getNavigation,
    getPageByPath,
    getPageAtPath,
    getRedirect,
    flattenNavigation,
    pageHref,
    isReservedPath,
    isChromePath,
} from "./cms.js";
export type { Post, Ref, Term, Page, NavItem, Breadcrumb, PageAtPath, Redirect } from "./cms.js";
export { Navigation, Breadcrumbs } from "./screens/navigation.js";
export type { NavigationProps, BreadcrumbsProps } from "./screens/navigation.js";

export { renderMarkdown, isSafeHref, anchor, markdownHeadings } from "./markdown.js";
export type { RenderMarkdownOptions, MarkdownHeading } from "./markdown.js";

export { Asset, renderProse, suppliedAssetFor, suppliedAssetOn, clearSpaceOf } from "./assets.js";
export type { AssetProps, SuppliedProps } from "./assets.js";

export { createBlogIndex, Card } from "./screens/blog-index.js";
export {
    createBlogPost,
    createBlogPostPreview,
    createPostMetadata,
    createPostStaticParams,
} from "./screens/blog-post.js";
export { createArchive, createArchiveStaticParams } from "./screens/archive.js";
export { PostView } from "./screens/post-view.js";

export {
    listAllCollection,
    listCollection,
    getItem,
    getItemPreview,
    searchCollection,
    toItem,
    collectionOf,
    referencedBy,
} from "./collections.js";
export {
    collectionTree,
    editHref,
    flattenTree,
    itemHeadings,
    treeNeighbours,
    treeProducts,
    treeSearchIndex,
    TREE_INDEX_LIMIT,
    TREE_MAX_DEPTH,
} from "./tree.js";
export type {
    CollectionTreeOptions,
    CollectionTreeResult,
    TreeNeighbours,
    TreeNode,
    TreeSearchEntry,
    TreeSection,
} from "./tree.js";
export type { Item, ListCollectionOptions, CollectionPage, CollectionRun } from "./collections.js";
export {
    createCollectionIndex,
    createCollectionDetail,
    createCollectionMetadata,
    createCollectionStaticParams,
    ItemView,
    itemMetadata,
} from "./screens/collection.js";
export type {
    CardProps,
    ItemViewProps,
    CollectionIndexOptions,
    CollectionDetailOptions,
} from "./screens/collection.js";
export type { PostViewProps } from "./screens/post-view.js";
export { ArticleView } from "./screens/article-view.js";
export type { ArticleRelated, ArticleViewProps } from "./screens/article-view.js";
export {
    EditLink,
    SearchBox,
    TreeAside,
    TreePager,
    TreeRail,
    TreeShell,
    TreeSidebar,
    TreeSwitcher,
    treeVariant,
} from "./screens/tree.js";
export type {
    SearchBoxProps,
    TreeAsideProps,
    TreePagerProps,
    TreeRailProps,
    TreeSidebarProps,
    TreeSwitcherProps,
} from "./screens/tree.js";

export {
    defineBlock,
    resolveBlocks,
    readProps,
    blockSchema,
    accepts,
    isBindable,
    MAX_BLOCKS,
    MAX_DEPTH,
    MAX_FIELD_DEPTH,
    MAX_LIST_ITEMS,
    LIST_ITEM_KINDS,
} from "./blocks/schema.js";
export type {
    BlockDefinition,
    BlockField,
    BlockProps,
    BlockComponentProps,
    BlockRegistry,
    BlockSchema,
    FieldKind,
    ListItem,
    ListItemKind,
    SchemaField,
    ResolvedBlock,
    ResolveOptions,
} from "./blocks/schema.js";
export { createBlockRegistry, registryFor } from "./blocks/registry.js";
export { builtInBlocks, collectionItems, BLOCK_PROSE_CLASS } from "./blocks/built-in.js";
export type { CollectionItem } from "./blocks/built-in.js";
export { primitiveBlocks, PROSE_CLASS, ICONS, FLOW_COLUMNS } from "./blocks/primitives.js";
export {
    dataBlocks,
    SOURCE_BLOCK,
    REPEAT_BLOCK,
    SHOW_IF_BLOCK,
    SLOT_BLOCK,
    PAGER_BLOCK,
    MAX_SOURCES,
    MAX_SOURCE_ROWS,
} from "./blocks/data.js";
export {
    TONES,
    SPACES,
    TEXT_ROLES,
    TEXT_VARIANTS,
    TEXT_VARIANT_NAMES,
    RADII,
    WIDTHS,
    toneOf,
    toneNames,
    spaceOf,
    radiusOf,
    widthOf,
} from "./blocks/tokens.js";
export type { Tone, ToneName } from "./blocks/tokens.js";
export {
    BINDING_SCOPES,
    BINDING_FORMATS,
    BindingSource,
    bindText,
    bindValue,
    wholeBinding,
    readBindings,
    hasBinding,
    formatValue,
    MAX_TEMPLATE,
} from "./blocks/bindings.js";
export type {
    Binding,
    BindingFormat,
    BindingOptions,
    BindingProblem,
    BindingScope,
    BindingScopes,
    BindingWhere,
} from "./blocks/bindings.js";
export { bindBlocks, itemScope, pageScope, siteScope, queryScope } from "./blocks/bind.js";
export type { BindPageOptions } from "./blocks/bind.js";
export { presetsFrom, compilePreset, withPresets, MAX_PRESETS, MAX_PRESET_BLOCKS } from "./blocks/presets.js";
export { libraryPresets } from "./blocks/library.js";
export type { BlockPreset } from "./blocks/presets.js";
export { BlockList } from "./blocks/render.js";
export {
    createPage,
    createHome,
    createHomeMetadata,
    createViewerPage,
    createPageMetadata,
    createPageStaticParams,
    createSiteStaticParams,
    pageBlocks,
    PageView,
} from "./screens/page.js";
export type { PageOptions, PageViewProps } from "./screens/page.js";
export { createBlockSchemaRoute, createBlockSchemaPreflight, parseOrigins } from "./routes/block-schema.js";
export type { BlockSchemaRouteOptions } from "./routes/block-schema.js";

export { createPressProxy } from "./proxy.js";

export type { PressStore } from "./store.js";

export { createBindingReportRoute, createBindingReportPreflight } from "./routes/binding-report.js";
export type { BindingReport, BindingReportOptions } from "./routes/binding-report.js";
export { createRevalidateRoute } from "./routes/revalidate.js";
export { revalidateKeyFor, bindingsKeyFor } from "./revalidate-key.js";
export { createSharePage, createShareRedeemRoute, SHARE_INVALID_FRAGMENT } from "./routes/share.js";
export type { SharePageOptions } from "./routes/share.js";
export type { RevalidateOptions } from "./routes/revalidate.js";
export { createFeed } from "./routes/feed.js";
export type { FeedOptions } from "./routes/feed.js";
export { createSitemap, SITEMAP_MAX_URLS } from "./routes/sitemap.js";
export { createRobots } from "./routes/robots.js";
