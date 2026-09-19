import type { PressConfig } from "./config.js";
import { includesFor } from "./config.js";
import {
    bySlug,
    bySlugPreview,
    list,
    navigationTree,
    pageAtPath,
    redirectAt,
    type PublicContent,
    type Seo,
} from "./delivery.js";
import { samePath, siteHref } from "./site.js";

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
    return c ? toTerm(config, c) : null;
}

function toTerm(config: PressConfig, c: PublicContent): Term {
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

/** Authors or categories, for a collection block. Empty when the site has no such type. */
export async function listTerms(
    config: PressConfig,
    which: "author" | "category",
    pageSize: number,
): Promise<Term[]> {
    const type = config.types[which];
    if (!type) return [];
    const res = await list(config, type, { pageSize });
    return res.items.map((c) => toTerm(config, c));
}

export interface Page {
    id: string;
    slug: string;
    title: string;
    summary?: string;
    body: string;
    /*
     * Unknown on purpose. It is whatever an editor typed into a json field, so nothing here trusts
     * its shape; `resolveBlocks` in src/blocks is the one place that reads it.
     */
    blocks?: unknown;
    seo?: Seo;
    /** The entry as the API returned it, so a binding can read a field by the name the tenant gave it. */
    content?: PublicContent;
}

export function toPage(config: PressConfig, c: PublicContent): Page {
    const d = c.data;
    const f = config.pageFields;
    return {
        id: c.id,
        slug: c.slug ?? str(field(d, f.slug)),
        title: str(field(d, f.title)) || "Untitled",
        summary: str(field(d, f.summary)) || undefined,
        body: str(field(d, f.body)),
        blocks: field(d, f.blocks),
        seo: c.seo ?? undefined,
        content: c,
    };
}

export async function getPage(config: PressConfig, slug: string): Promise<Page | null> {
    const type = config.types.page;
    if (!type) return null;
    const c = await bySlug(config, type, slug);
    return c ? toPage(config, c) : null;
}

/*
 * The page tree, from the Pages module.
 *
 * The CMS decides everything about it: which pages are in the menu, their order, their nesting and
 * their paths. Nothing here sorts, nests, filters or derives a path. What is checked is shape, since
 * the body crosses a process boundary: an item whose path is not a plain site path is dropped rather
 * than repaired, and the tree is capped so a broken body cannot make an unbounded menu.
 */

export interface NavItem {
    id: string;
    title: string;
    slug: string;
    /** The page's path as the Pages module gave it. `pageHref` puts it under the mount. */
    path: string;
    order?: number;
    children: NavItem[];
}

export interface Breadcrumb {
    id: string;
    title: string;
    slug: string;
    path: string;
}

const NAV_MAX_DEPTH = 9;
const NAV_MAX_ITEMS = 500;

function pagePath(v: unknown): string | undefined {
    if (typeof v !== "string" || v.length > 2048 || !v.startsWith("/") || v.startsWith("//")) return undefined;
    return /^\/[^\s\\<>"'?#]*$/.test(v) ? v : undefined;
}

function navItems(raw: unknown, depth: number, budget: { left: number }): NavItem[] {
    if (!Array.isArray(raw) || depth > NAV_MAX_DEPTH) return [];
    const out: NavItem[] = [];
    for (const item of raw) {
        if (budget.left <= 0) break;
        if (!item || typeof item !== "object") continue;
        const d = item as Record<string, unknown>;
        const path = pagePath(d.path);
        if (!path) continue;
        budget.left--;
        const slug = str(d.slug);
        out.push({
            id: str(d.id),
            title: str(d.title) || slug || path,
            slug,
            path,
            order: typeof d.order === "number" ? d.order : undefined,
            children: navItems(d.children, depth + 1, budget),
        });
    }
    return out;
}

function breadcrumbs(raw: unknown): Breadcrumb[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, NAV_MAX_DEPTH + 1).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const d = item as Record<string, unknown>;
        const path = pagePath(d.path);
        if (!path) return [];
        const slug = str(d.slug);
        return [{ id: str(d.id), title: str(d.title) || slug || path, slug, path }];
    });
}

/**
 * The site menu, in the order the CMS gave it. Empty when the site mounts no pages, when the module is
 * not installed, or when its body speaks a contract this renderer does not read. A failed read throws,
 * so a caller that must not fail catches it.
 */
export async function getNavigation(config: PressConfig): Promise<NavItem[]> {
    if (config.pages === undefined) return [];
    const tree = await navigationTree(config);
    return tree ? navItems(tree.items, 0, { left: NAV_MAX_ITEMS }) : [];
}

/** Every path in a menu, parents before their children. */
export function flattenNavigation(items: NavItem[]): string[] {
    return items.flatMap((item) => [item.path, ...flattenNavigation(item.children)]);
}

export interface PageAtPath {
    page: Page;
    /** The path the CMS says the page lives at. */
    path: string;
    /** From the root down to the page itself. */
    breadcrumbs: Breadcrumb[];
}

/** The page the Pages module serves at a path, with its breadcrumbs, or null. Needs no page type in the config. */
export async function getPageByPath(config: PressConfig, path: string): Promise<PageAtPath | null> {
    const resolved = await pageAtPath(config, path);
    if (!resolved) return null;
    return {
        page: toPage(config, resolved.entry),
        path: pagePath(resolved.path) ?? path,
        breadcrumbs: breadcrumbs(resolved.breadcrumbs),
    };
}

/** The page the Pages module serves at a site path, or null. */
export async function getPageAtPath(config: PressConfig, path: string): Promise<Page | null> {
    return (await getPageByPath(config, path))?.page ?? null;
}

/** The site path a page is served at: its path under the configured mount. */
export function pageHref(config: PressConfig, path: string): string {
    const mount = config.pages ?? "";
    if (!mount) return path;
    return path === "/" ? mount : `${mount}${path}`;
}

/**
 * True when the site mounts pages at the root and this path's first segment is taken: by a reserved
 * slug, or by the route of a collection, which the catch-all serves in place of a page. A tenant's
 * collections come from its settings, so this reads the resolved config's collections every time.
 */
export function isReservedPath(config: PressConfig, path: string): boolean {
    if (config.pages !== "") return false;
    const first = path.split("/").find(Boolean)?.toLowerCase();
    if (first === undefined) return false;
    if (config.reservedSlugs.includes(first)) return true;
    return Object.values(config.collections).some((c) => c.route?.split("/").find(Boolean)?.toLowerCase() === first);
}

/**
 * True when the site draws the page at this path as chrome rather than serving it as a place to go:
 * a header or footer region (#48), or the holding page. The path is relative to the pages mount, the
 * same as `isReservedPath` takes it.
 *
 * Such a page is on every page of the site already, so it has no business in the menu or the
 * sitemap. It still answers on its own route, which is what lets an editor open it to work on it.
 */
export function isChromePath(config: PressConfig, path: string): boolean {
    const drawn = [config.holding?.path, config.regions?.header?.path, config.regions?.footer?.path];
    if (drawn.every((p) => p === undefined)) return false;
    const href = pageHref(config, path);
    return drawn.some((p) => p !== undefined && samePath(href, p));
}

export interface Redirect {
    to: string;
    permanent: boolean;
}

/**
 * Where the CMS redirects map sends a site path, or null when nothing moved. A destination that is not
 * a site path or an http or https URL is ignored, as is one that points back at the path asked about.
 */
export async function getRedirect(config: PressConfig, path: string): Promise<Redirect | null> {
    const answer = await redirectAt(config, path);
    const to = answer ? siteHref(answer.toPath) : undefined;
    if (!answer || !to || to === path) return null;
    return { to, permanent: answer.status === 301 || answer.status === 308 };
}

export async function listPages(
    config: PressConfig,
    opts: { page?: number; pageSize?: number } = {},
): Promise<{ pages: Page[]; hasNextPage: boolean }> {
    const type = config.types.page;
    if (!type) return { pages: [], hasNextPage: false };
    const res = await list(config, type, {
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? config.pageSizes.index,
    });
    return { pages: res.items.map((c) => toPage(config, c)), hasNextPage: res.hasNextPage };
}

export function formatDate(config: PressConfig, value?: string): string {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString(config.locale, { day: "numeric", month: "long", year: "numeric" });
}
