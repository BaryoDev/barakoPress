/*
 * The seam.
 *
 * Everything a site differs on lives here, so a consumer configures the engine instead of forking
 * it. That matters because barakoCMS content types are defined at runtime: a client's posts are as
 * likely to be `article` with a `Headline` as they are to be the blog blueprint's `post` and
 * `Title`. An engine that compiles one shape in is one client's blog wearing a package name.
 *
 * The defaults are the `blog` blueprint the API ships, so a site that used the blueprint passes
 * nothing and gets the same behaviour as before this existed.
 *
 * Config reaches the screens through factories rather than a global, because a Next route is a
 * file and a package cannot write files into someone else's app. A consumer's route file calls
 * `createBlogIndex(config)` and exports the result. One import, one call, full control.
 */

import { resolveTheme, type PressTheme, type PressThemeInput } from "./theme.js";

/*
 * The attributes the markdown renderer puts on a link. The browser entry, barakopress/markdown,
 * imports these, so this file must keep importing nothing from next/* or node:* and must not read
 * process.env at module scope.
 */
export const LINK_REL = "noopener noreferrer";
export const NEW_TAB_TARGET = "_blank";

/** The singleton content type a tenant's site settings live in, unless `sites.settingsType` names another. */
export const SETTINGS_TYPE = "site";

/** The keys of the blog's own collections, which the blog factories render. */
export const POST_COLLECTION = "post";
export const AUTHOR_COLLECTION = "author";
export const CATEGORY_COLLECTION = "category";

/** Where a reference into a type that is no configured collection keeps its name and slug. */
export const REFERENCE_FIELDS: { title: FieldNames; slug: FieldNames } = { title: ["Name", "Title"], slug: ["Slug"] };

export interface TypeNames {
    /** The content type holding posts. */
    post: string;
    /** The type an author reference points at. Omit if the model has no authors. */
    author?: string;
    /** The type a category reference points at. Omit if the model has no categories. */
    category?: string;
    /** The type holding standalone pages. Omit if the site mounts no page route. */
    page?: string;
}

/**
 * Which field on the post type holds what.
 *
 * Only `title` and `body` are required; everything else is a feature the site does without if the
 * model has no field for it. An absent name means the engine never asks for that data and never
 * renders it, rather than rendering an empty slot.
 */
export interface FieldMap {
    title: string;
    body: string;
    slug?: string;
    excerpt?: string;
    publishedAt?: string;
    coverImage?: string;
    coverImageAlt?: string;
    featured?: string;
    tags?: string;
    /** The reference field pointing at the author type. */
    author?: string;
    /** The reference field pointing at the category type. */
    category?: string;
}

/**
 * Which field on the page type holds what. Its own map because a page is not a post: it has no
 * author, date or tags, and a post has no block list.
 */
export interface PageFieldMap {
    title: string;
    slug?: string;
    summary?: string;
    /** Markdown, rendered when the page has no blocks. */
    body?: string;
    /** A json field holding an ordered list of `{ type, props }`. See src/blocks. */
    blocks?: string;
}

/** Where the consumer mounted each route, so generated links match the app's real shape. */
export interface RouteMap {
    /** The post route's prefix, for example "/blog" or "/writing". */
    post: string;
    author?: string;
    category?: string;
}

export interface PageSizes {
    index: number;
    feed: number;
    sitemap: number;
    archive: number;
}

/** A link a site shows. `href` is a path on the site or an absolute http or https URL. */
export interface SiteLink {
    label: string;
    href: string;
}

export interface FooterColumn {
    heading: string;
    links: SiteLink[];
}

export interface SocialLink {
    network: string;
    href: string;
}

export interface TopBar {
    text?: string;
    links: SiteLink[];
}

export interface SiteIdentity {
    name: string;
    tagline?: string;
    /** Absolute origin, used for every absolute link in the feed, sitemap and robots. */
    url: string;
    logo?: string;
    logoAlt?: string;
    footerLogo?: string;
    favicon?: string;
    shareImage?: string;
    copyright?: string;
    topBar?: TopBar;
    headerLinks?: SiteLink[];
    footerColumns?: FooterColumn[];
    socialLinks?: SocialLink[];
}

/**
 * Request-time sites: one build serving several tenants, each read from its own site settings.
 *
 * Present means on. Absent, the engine behaves exactly as a build-time site: identity and theme
 * come from this file and nothing reads the request. See src/site.ts.
 */
export interface SitesConfig {
    /** The singleton content type holding a tenant's identity and theme. */
    settingsType: string;
    /**
     * The request header the host is read from. `host` unless a proxy in front rewrites it, in which
     * case the operator names the header that proxy sets. Never a forwarded header by default,
     * because any caller can send one.
     */
    hostHeader: string;
    /**
     * A request header carrying the tenant handle directly. Off unless named, and only safe when a
     * proxy in front sets it and strips any value a caller sent.
     */
    tenantHeader?: string;
    /**
     * The tenant a host with no tenant of its own falls back to. Unset, such a host is a 404.
     * `CMS_DEFAULT_TENANT` is read at request time when this is not set.
     */
    defaultTenant?: string;
}

/**
 * A tenant's holding mode, read from its site settings (`Mode: "Holding"`). Present only while holding.
 *
 * Nothing secret lives here. A share link is redeemed through barakoCMS, and barakoPress never sees
 * a hash of its key.
 */
export interface Holding {
    /** `HoldingPath`: the site path of the page shown on every route. Absent renders the default holding page. */
    path?: string;
}

/**
 * A field name, or several tried in order until one holds a value. A name starting with "@" reads the
 * entry itself rather than its data: "@createdAt" or "@updatedAt".
 */
export type FieldNames = string | string[];

/** Which field on a collection's type holds what. Only `title` is required. */
export interface CollectionFields {
    title: FieldNames;
    slug?: FieldNames;
    /** Plain text under the title. */
    summary?: FieldNames;
    /** Markdown. */
    body?: FieldNames;
    date?: FieldNames;
    image?: FieldNames;
    imageAlt?: FieldNames;
    /** A boolean. A featured item leads its list. */
    featured?: FieldNames;
    /** A list of strings. */
    tags?: FieldNames;
    /** A link shown on the item's page. Only a site path or an http or https URL is shown. */
    url?: FieldNames;
}

export interface CollectionReference {
    /** The key of the collection the reference points into. */
    collection: string;
    /** The word a card puts before the link, for example "by". */
    label?: string;
    /** Whether the feed names the target as the item's category. */
    inFeed?: boolean;
}

/**
 * A content type the site renders as a list and a detail page. A hospital's doctors, a law firm's
 * people and the blog's posts are each one of these.
 */
export interface CollectionConfig {
    /** The content type holding the items. */
    type: string;
    /** The index is served at the route and an item at `${route}/${slug}`. Absent, items are listed and never linked. */
    route?: string;
    fields: CollectionFields;
    /** Reference fields on the type, by field name, in the order a card shows them. */
    references?: Record<string, CollectionReference>;
    /** Sent to the API, so ordering covers every row. For example "-PublishedAt". */
    sort?: string;
    /** Whether `createFeed(config, key)` serves it. */
    feed?: boolean;
    /** Whether its items are in the sitemap. On unless false. */
    sitemap?: boolean;
    /**
     * Whether the root catch-all serves an index at the route. On unless false. An item page below the
     * route is served either way, and a route file calling `createCollectionIndex` ignores this.
     */
    index?: boolean;
    /** Items on its index. `pageSizes.index` when unset. */
    pageSize?: number;
    /** The heading of its index. The site's name and tagline when unset. */
    label?: string;
    /** How a count of its items reads, singular then plural. */
    noun?: [string, string];
    /** A choice field whose option picks the item's colour from `optionColors`. */
    colorBy?: string;
}

export interface PressConfig {
    types: TypeNames;
    fields: FieldMap;
    pageFields: PageFieldMap;
    routes: RouteMap;
    site: SiteIdentity;
    pageSizes: PageSizes;
    /** The cache tag this site purges. Two sites on one server need two tags. */
    cacheTag: string;
    /** How long a cached read may live with no webhook. Zero disables the backstop. */
    backstopSeconds: number;
    /** How long a read from the CMS may take before it counts as failed and the last good answer stands in. */
    cmsTimeoutMs: number;
    /** Passed to toLocaleDateString. */
    locale: string;
    /** Where the CMS is, from this server. */
    cmsUrl: string;
    /** Tenant slug, for a multi-tenant deployment. */
    tenant?: string;
    /** What the screens look like. See theme.ts for why appearance is config and not a stylesheet. */
    theme: PressTheme;
    /** Set when identity and theme are read per request from the tenant's site settings. */
    sites?: SitesConfig;
    /** Set by the tenant's settings on a request-time site while it is holding. Never set by hand. */
    holding?: Holding;
    /**
     * Where the Pages module's pages are mounted: "" is the site root, "/docs" puts /about at
     * /docs/about. Undefined means the site renders no page tree: no menu, no catch-all, no page in the
     * sitemap.
     */
    pages?: string;
    /**
     * First path segments a page mounted at the root may not take, lowercased. A page there would sit
     * on a route the app answers itself, and Next resolves a static segment before a catch-all, so it
     * would never render. The defaults are the configured routes and the files the engine mounts;
     * `reservedSlugs` in the input adds to them.
     */
    reservedSlugs: string[];
    /**
     * Every collection the site renders, by key. `post`, `author` and `category` are derived from
     * `types`, `fields` and `routes`; `collections` in the input adds to them or replaces one by key,
     * and a request-time site's `Collections` setting does the same per tenant.
     */
    collections: Record<string, CollectionConfig>;
    /**
     * Colours by `type.field`, then by option value, as CSS colours. A request-time site reads them from
     * the tenant's `OptionColors` setting.
     */
    optionColors: Record<string, Record<string, string>>;
}

export type PressConfigInput = {
    types?: Partial<TypeNames>;
    fields?: Partial<FieldMap>;
    pageFields?: Partial<PageFieldMap>;
    routes?: Partial<RouteMap>;
    site?: Partial<SiteIdentity>;
    pageSizes?: Partial<PageSizes>;
    /*
     * Nested partials, so a site overriding one colour keeps the other seventeen. A flat
     * Partial<PressTheme> would take the whole colours object or none of it, which in practice
     * means every consumer pastes the full palette to change an accent.
     */
    theme?: PressThemeInput;
    sites?: Partial<SitesConfig>;
} & Partial<Omit<PressConfig, "types" | "fields" | "pageFields" | "routes" | "site" | "pageSizes" | "theme" | "sites" | "holding">>;

/**
 * The `blog` blueprint, which is what `POST /api/content-types/blueprints/blog` creates.
 *
 * `Blocks` is the one name here the blueprint does not create. A json field has to be added to the
 * page type with `POST /api/content-types/page/fields`, and until it is, a page renders its Body.
 */
const BLOG_BLUEPRINT: Pick<PressConfig, "types" | "fields" | "pageFields"> = {
    types: { post: "post", author: "author", category: "category", page: "page" },
    fields: {
        title: "Title",
        slug: "Slug",
        excerpt: "Excerpt",
        body: "Body",
        coverImage: "CoverImage",
        coverImageAlt: "CoverImageAlt",
        publishedAt: "PublishedAt",
        featured: "Featured",
        tags: "Tags",
        author: "Author",
        category: "Category",
    },
    pageFields: {
        title: "Title",
        slug: "Slug",
        summary: "Summary",
        body: "Body",
        blocks: "Blocks",
    },
};

function trimSlash(path: string): string {
    let end = path.length;
    while (end > 0 && path.charCodeAt(end - 1) === 47) end--;
    return path.slice(0, end);
}

/*
 * The blog as collections. A site that sets types, fields and routes the way it always did gets these
 * three and the blog factories render them, so nothing about such a site changes. The term types keep
 * the names the archive always fell back through, and a reference is resolved only when its type exists,
 * because `include` names a field the API answers 400 for otherwise.
 */
function blogCollections(types: TypeNames, fields: FieldMap, routes: RouteMap): Record<string, CollectionConfig> {
    const names = (...list: (string | undefined)[]) => list.filter((n): n is string => Boolean(n));
    const references: Record<string, CollectionReference> = {};
    if (types.author && fields.author) references[fields.author] = { collection: AUTHOR_COLLECTION, label: "by" };
    if (types.category && fields.category) {
        references[fields.category] = { collection: CATEGORY_COLLECTION, label: "in", inFeed: true };
    }

    const collections: Record<string, CollectionConfig> = {
        [POST_COLLECTION]: {
            type: types.post,
            route: routes.post,
            fields: {
                title: fields.title,
                slug: fields.slug,
                summary: fields.excerpt,
                body: fields.body,
                date: names(fields.publishedAt, "@createdAt"),
                image: fields.coverImage,
                imageAlt: fields.coverImageAlt,
                featured: fields.featured,
                tags: fields.tags,
            },
            references,
            sort: fields.publishedAt ? `-${fields.publishedAt}` : undefined,
            feed: true,
            noun: ["post", "posts"],
        },
    };

    const term = (type: string, route: string | undefined, url?: string): CollectionConfig => ({
        type,
        route,
        fields: {
            title: names("Name", "Title", fields.title),
            slug: names(fields.slug, "Slug"),
            body: names("Description", "Bio"),
            ...(url ? { url } : {}),
        },
        sitemap: false,
        // Never listed at /authors or /categories unless a site mounts that route file itself, since no
        // blog site ever had those pages and a public list of either is a decision, not a default.
        index: false,
    });
    if (types.author) collections[AUTHOR_COLLECTION] = term(types.author, routes.author, "Website");
    if (types.category) collections[CATEGORY_COLLECTION] = term(types.category, routes.category);
    return collections;
}

function ownCollections(input: Record<string, CollectionConfig> | undefined): Record<string, CollectionConfig> {
    return Object.fromEntries(
        Object.entries(input ?? {}).map(([key, c]) => {
            if (c.route === undefined) return [key, c];
            const route = mountPath(c.route);
            // At the root an item would sit at /slug, where pages and every other route already are.
            if (!route) throw new Error(`collection "${key}" cannot be mounted at the site root`);
            return [key, { ...c, route }];
        }),
    );
}

/** Paths the engine's own route files answer, which a page at the site root must not take. */
const RESERVED_AT_ROOT = ["api", "feed.xml", "sitemap.xml", "robots.txt", "_next", "_share", "%5fshare", "favicon.ico"];

function firstSegment(route: string | undefined): string | undefined {
    return route?.split("/").find(Boolean)?.toLowerCase();
}

/** "" for the root, otherwise a path with one leading slash and none trailing. */
function mountPath(value: string): string {
    const trimmed = trimSlash(value.trim());
    if (!trimmed) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function reservedSlugs(routes: (string | undefined)[], extra: string[] | undefined): string[] {
    const named = [...RESERVED_AT_ROOT, ...routes.map(firstSegment), ...(extra ?? []).map((s) => s.trim().toLowerCase())];
    return [...new Set(named.filter((s): s is string => Boolean(s)))];
}

/**
 * Builds a complete config from a partial one.
 *
 * Site name and URL have no sensible default: a fallback of the engine's own name is how a client
 * site ends up with the vendor's brand in its masthead, so they are required and the type says so.
 * The one exception is a request-time site (`sites`), whose identity is the tenant's settings. What
 * `site` holds there is only the fallback for a field the settings leave out.
 */
/** AbortSignal.timeout takes a whole number of milliseconds up to 2^32 - 1 and throws on anything else. */
function timeoutMs(value: number | undefined): number {
    return Number.isInteger(value) && value! > 0 && value! <= 0xffff_ffff ? value! : 5_000;
}

export function defineConfig(
    input: PressConfigInput & ({ site: SiteIdentity } | { sites: Partial<SitesConfig> }),
): PressConfig {
    const routes = { post: "/blog", author: "/authors", category: "/categories", ...input.routes };
    const site = input.site ?? {};
    const types = { ...BLOG_BLUEPRINT.types, ...input.types };
    const fields = { ...BLOG_BLUEPRINT.fields, ...input.fields };
    const routeMap: RouteMap = {
        post: trimSlash(routes.post),
        author: routes.author ? trimSlash(routes.author) : undefined,
        category: routes.category ? trimSlash(routes.category) : undefined,
    };
    const collections = { ...blogCollections(types, fields, routeMap), ...ownCollections(input.collections) };

    return {
        types,
        fields,
        pageFields: { ...BLOG_BLUEPRINT.pageFields, ...input.pageFields },
        routes: routeMap,
        site: { ...site, name: site.name ?? "", url: trimSlash(site.url ?? "") },
        pageSizes: { index: 20, feed: 50, sitemap: 1000, archive: 50, ...input.pageSizes },
        cacheTag: input.cacheTag ?? "cms",
        backstopSeconds: input.backstopSeconds ?? 300,
        cmsTimeoutMs: timeoutMs(input.cmsTimeoutMs),
        locale: input.locale ?? "en-GB",
        cmsUrl: trimSlash(input.cmsUrl ?? process.env.CMS_URL ?? "http://localhost:5005"),
        tenant: input.tenant ?? process.env.CMS_TENANT ?? undefined,
        theme: resolveTheme(input.theme),
        collections,
        optionColors: input.optionColors ?? {},
        reservedSlugs: reservedSlugs(
            [routes.post, routes.author, routes.category, ...Object.values(collections).map((c) => c.route)],
            input.reservedSlugs,
        ),
        ...(input.pages !== undefined ? { pages: mountPath(input.pages) } : {}),
        ...(input.sites
            ? {
                  sites: {
                      settingsType: input.sites.settingsType ?? SETTINGS_TYPE,
                      hostHeader: (input.sites.hostHeader ?? "host").toLowerCase(),
                      tenantHeader: input.sites.tenantHeader?.toLowerCase(),
                      defaultTenant: input.sites.defaultTenant,
                  },
              }
            : {}),
    };
}

/**
 * The reference fields worth resolving in one request, as the API's `include` expects them.
 *
 * Only names the site actually has. Sending `include=Author,Category` unconditionally is a 400
 * from the API for any post type without both fields, which is every model that is not the blog
 * blueprint.
 */
export function includesFor(config: PressConfig): string[] {
    const wanted: (string | undefined)[] = [
        config.types.author ? config.fields.author : undefined,
        config.types.category ? config.fields.category : undefined,
    ];
    return wanted.filter((f): f is string => Boolean(f));
}
