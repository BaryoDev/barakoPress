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

/**
 * Builds a complete config from a partial one.
 *
 * Site name and URL have no sensible default: a fallback of the engine's own name is how a client
 * site ends up with the vendor's brand in its masthead, so they are required and the type says so.
 * The one exception is a request-time site (`sites`), whose identity is the tenant's settings. What
 * `site` holds there is only the fallback for a field the settings leave out.
 */
export function defineConfig(
    input: PressConfigInput & ({ site: SiteIdentity } | { sites: Partial<SitesConfig> }),
): PressConfig {
    const routes = { post: "/blog", author: "/authors", category: "/categories", ...input.routes };
    const site = input.site ?? {};

    return {
        types: { ...BLOG_BLUEPRINT.types, ...input.types },
        fields: { ...BLOG_BLUEPRINT.fields, ...input.fields },
        pageFields: { ...BLOG_BLUEPRINT.pageFields, ...input.pageFields },
        routes: {
            post: trimSlash(routes.post),
            author: routes.author ? trimSlash(routes.author) : undefined,
            category: routes.category ? trimSlash(routes.category) : undefined,
        },
        site: { ...site, name: site.name ?? "", url: trimSlash(site.url ?? "") },
        pageSizes: { index: 20, feed: 50, sitemap: 1000, archive: 50, ...input.pageSizes },
        cacheTag: input.cacheTag ?? "cms",
        backstopSeconds: input.backstopSeconds ?? 300,
        locale: input.locale ?? "en-GB",
        cmsUrl: trimSlash(input.cmsUrl ?? process.env.CMS_URL ?? "http://localhost:5005"),
        tenant: input.tenant ?? process.env.CMS_TENANT ?? undefined,
        theme: resolveTheme(input.theme),
        ...(input.sites
            ? {
                  sites: {
                      settingsType: input.sites.settingsType ?? "site",
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
