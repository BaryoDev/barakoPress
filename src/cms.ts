import type { PressConfig } from "./config";
import { includesFor } from "./config";
import { bySlug, bySlugPreview, list, type PublicContent, type Seo } from "./delivery";

export type { Seo };

/*
 * Mapping a stored entry onto what a page renders.
 *
 * Every field name comes from the config's field map, so a client whose post type calls its title
 * `Headline` configures that instead of forking this file. An absent name means the site has no
 * such field: the value is undefined and the screens leave the slot out rather than render it
 * empty.
 */

export interface Post {
    id: string;
    slug: string;
    title: string;
    excerpt?: string;
    body: string;
    publishedAt?: string;
    coverImage?: string;
    coverImageAlt?: string;
    featured: boolean;
    tags: string[];
    author?: Ref;
    category?: Ref;
    seo?: Seo;
}

export interface Ref {
    id: string;
    slug: string;
    name: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Reads a field by its configured name, or undefined when the site has no such field. */
function field(data: Record<string, unknown>, name: string | undefined): unknown {
    return name ? data[name] : undefined;
}

/*
 * A resolved reference. `include` gives back the whole target entry, so this handles that and a
 * bare id, and gives up rather than inventing a label when neither a name nor a slug is there.
 */
function toRef(config: PressConfig, v: unknown): Ref | undefined {
    if (!v || typeof v !== "object") return undefined;
    const d = v as Record<string, unknown>;
    const data = (d.data ?? d) as Record<string, unknown>;
    const name = str(data.Name) || str(data.Title) || str(field(data, config.fields.title));
    const slug = str(d.slug) || str(field(data, config.fields.slug)) || str(data.Slug);
    if (!name && !slug) return undefined;
    return { id: str(d.id), slug, name: name || slug };
}

export function toPost(config: PressConfig, c: PublicContent): Post {
    const d = c.data;
    const f = config.fields;
    const tags = field(d, f.tags);
    return {
        id: c.id,
        slug: c.slug ?? str(field(d, f.slug)),
        title: str(field(d, f.title)) || "Untitled",
        excerpt: str(field(d, f.excerpt)) || undefined,
        body: str(field(d, f.body)),
        publishedAt: str(field(d, f.publishedAt)) || c.createdAt || undefined,
        coverImage: str(field(d, f.coverImage)) || undefined,
        coverImageAlt: str(field(d, f.coverImageAlt)) || undefined,
        featured: field(d, f.featured) === true,
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
        author: toRef(config, field(d, f.author)),
        category: toRef(config, field(d, f.category)),
        seo: c.seo ?? undefined,
    };
}

/*
 * Ordering is asked of the API, not done here.
 *
 * Sorting the page that came back only orders those rows, so on a blog past one page the "newest"
 * list is newest-of-an-arbitrary-page. The API can order every row, so it does.
 */
function sortKey(config: PressConfig): string | undefined {
    return config.fields.publishedAt ? `-${config.fields.publishedAt}` : undefined;
}

export async function listPosts(
    config: PressConfig,
    opts: { page?: number; pageSize?: number } = {},
): Promise<{ posts: Post[]; total: number; hasNextPage: boolean }> {
    const res = await list(config, config.types.post, {
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? config.pageSizes.index,
        include: includesFor(config),
        sort: sortKey(config),
    });
    return {
        posts: res.items.map((c) => toPost(config, c)),
        total: res.totalItems,
        hasNextPage: res.hasNextPage,
    };
}

export async function getPost(config: PressConfig, slug: string): Promise<Post | null> {
    const c = await bySlug(config, config.types.post, slug);
    return c ? toPost(config, c) : null;
}

export async function getPostPreview(
    config: PressConfig,
    slug: string,
    token: string,
): Promise<Post | null> {
    const c = await bySlugPreview(config, config.types.post, slug, token);
    return c ? toPost(config, c) : null;
}

/*
 * Filtering by a reference takes the target's id, not its slug, so an archive is two calls:
 * resolve the slug, then filter. Both are cached and tagged, so it costs two reads once.
 */
async function idForSlug(config: PressConfig, type: string, slug: string): Promise<string | null> {
    const c = await bySlug(config, type, slug);
    return c?.id ?? null;
}

/** Posts by author or category. Null when the site has no such type, or the slug is unknown. */
export async function listPostsBy(
    config: PressConfig,
    which: "author" | "category",
    slug: string,
): Promise<Post[] | null> {
    const type = config.types[which];
    const fieldName = config.fields[which];
    if (!type || !fieldName) return null;

    const id = await idForSlug(config, type, slug);
    if (!id) return null;

    const res = await list(config, config.types.post, {
        pageSize: config.pageSizes.archive,
        include: includesFor(config),
        filter: [[fieldName, "eq", id]],
        sort: sortKey(config),
    });
    return res.items.map((c) => toPost(config, c));
}

export interface Term {
    id: string;
    slug: string;
    name: string;
    description?: string;
    photo?: string;
    website?: string;
}

/*
 * An author or category entry, for the heading of its archive page.
 *
 * These secondary types keep the blueprint's names with the post type's title and slug as
 * fallbacks. One flat field map cannot describe three types, and a model whose author type
 * differs wholesale wants its own screen. That is a fair boundary for the engine, and it is
 * stated here so nobody discovers it by reading the source.
 */
export async function getTerm(
    config: PressConfig,
    which: "author" | "category",
    slug: string,
): Promise<Term | null> {
    const type = config.types[which];
    if (!type) return null;
    const c = await bySlug(config, type, slug);
    if (!c) return null;

    const d = c.data;
    return {
        id: c.id,
        slug: c.slug ?? (str(field(d, config.fields.slug)) || str(d.Slug)),
        name: str(d.Name) || str(d.Title) || str(field(d, config.fields.title)) || "Untitled",
        description: str(d.Description) || str(d.Bio) || undefined,
        photo: str(d.Photo) || undefined,
        website: str(d.Website) || undefined,
    };
}

export function formatDate(config: PressConfig, value?: string): string {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString(config.locale, { day: "numeric", month: "long", year: "numeric" });
}
