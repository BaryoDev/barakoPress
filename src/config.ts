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

export interface TypeNames {
    /** The content type holding posts. */
    post: string;
    /** The type an author reference points at. Omit if the model has no authors. */
    author?: string;
    /** The type a category reference points at. Omit if the model has no categories. */
    category?: string;
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

export interface SiteIdentity {
    name: string;
    tagline?: string;
    /** Absolute origin, used for every absolute link in the feed, sitemap and robots. */
    url: string;
}

export interface PressConfig {
    types: TypeNames;
    fields: FieldMap;
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
}

export type PressConfigInput = {
    types?: Partial<TypeNames>;
    fields?: Partial<FieldMap>;
    routes?: Partial<RouteMap>;
    site?: Partial<SiteIdentity>;
    pageSizes?: Partial<PageSizes>;
} & Partial<Omit<PressConfig, "types" | "fields" | "routes" | "site" | "pageSizes">>;

/** The `blog` blueprint, which is what `POST /api/content-types/blueprints/blog` creates. */
const BLOG_BLUEPRINT: Pick<PressConfig, "types" | "fields"> = {
    types: { post: "post", author: "author", category: "category" },
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
};

function trimSlash(path: string): string {
    return path.replace(/\/+$/, "");
}

/**
 * Builds a complete config from a partial one.
 *
 * Site name and URL have no sensible default: a fallback of the engine's own name is how a client
 * site ends up with the vendor's brand in its masthead, so they are required and the type says so.
 */
export function defineConfig(input: PressConfigInput & { site: SiteIdentity }): PressConfig {
    const routes = { post: "/blog", author: "/authors", category: "/categories", ...input.routes };

    return {
        types: { ...BLOG_BLUEPRINT.types, ...input.types },
        fields: { ...BLOG_BLUEPRINT.fields, ...input.fields },
        routes: {
            post: trimSlash(routes.post),
            author: routes.author ? trimSlash(routes.author) : undefined,
            category: routes.category ? trimSlash(routes.category) : undefined,
        },
        site: { ...input.site, url: trimSlash(input.site.url) },
        pageSizes: { index: 20, feed: 50, sitemap: 1000, archive: 50, ...input.pageSizes },
        cacheTag: input.cacheTag ?? "cms",
        backstopSeconds: input.backstopSeconds ?? 300,
        locale: input.locale ?? "en-GB",
        cmsUrl: trimSlash(input.cmsUrl ?? process.env.CMS_URL ?? "http://localhost:5005"),
        tenant: input.tenant ?? process.env.CMS_TENANT ?? undefined,
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
