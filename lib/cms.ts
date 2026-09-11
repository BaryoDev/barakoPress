import { list, bySlug, bySlugPreview, CMS_TAG, type PublicContent, type Seo } from "./delivery";

export { CMS_TAG };
export type { Seo };

/*
 * The read path, and the caching decision that defines this project.
 *
 * Pages are rendered on the server, but they are not re-read from the database on every request.
 * Every call below is cached by Next with no time limit and tagged, and the cache is dropped only
 * when barakoCMS says something changed, through the webhook in app/api/revalidate. So the steady
 * state is zero database reads: nginx and Next serve HTML that was rendered once. A publish drops
 * the tag, the next request renders that page again, and it goes back to being free.
 *
 * That is the difference from a static export, which is what this replaces. A static site reads at
 * build time and needs a full rebuild and redeploy to show an edit. This shows it in one request,
 * and still does not touch Postgres for ordinary traffic.
 *
 * The tag is deliberately coarse. Dropping every page on any publish costs a handful of renders and
 * removes a whole class of bug where a post appears on its own page but not in the list, or in the
 * list but not the feed. Split the tag only when a measurement says to.
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

/*
 * Field names are PascalCase because they come from the `blog` blueprint the API ships, which is
 * what created these types. This function is the only place that knows them: rename a field in the
 * console and this is the file to change.
 */
function toRef(v: unknown): Ref | undefined {
    if (!v || typeof v !== "object") return undefined;
    const d = v as Record<string, unknown>;
    const data = (d.data ?? d) as Record<string, unknown>;
    const name = str(data.Name) || str(data.Title);
    const slug = str(d.slug) || str(data.Slug);
    if (!name && !slug) return undefined;
    return { id: str(d.id), slug, name: name || slug };
}

export function toPost(c: PublicContent): Post {
    const d = c.data;
    const seo = c.seo;
    return {
        id: c.id,
        slug: c.slug ?? str(d.Slug),
        title: str(d.Title) || "Untitled",
        excerpt: str(d.Excerpt) || undefined,
        body: str(d.Body),
        publishedAt: str(d.PublishedAt) || c.createdAt || undefined,
        coverImage: str(d.CoverImage) || undefined,
        coverImageAlt: str(d.CoverImageAlt) || undefined,
        featured: d.Featured === true,
        tags: Array.isArray(d.Tags) ? d.Tags.filter((t): t is string => typeof t === "string") : [],
        author: toRef(d.Author),
        category: toRef(d.Category),
        seo: seo ?? undefined,
    };
}

const byNewest = (a: Post, b: Post) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");

/** Published posts, newest first. `include` resolves the author and category in the same request. */
export async function listPosts(opts: { page?: number; pageSize?: number } = {}) {
    const res = await list("post", {
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? 20,
        include: ["Author", "Category"],
    });
    return { posts: res.items.map(toPost).sort(byNewest), total: res.totalItems };
}

export async function getPost(slug: string): Promise<Post | null> {
    const c = await bySlug("post", slug);
    return c ? toPost(c) : null;
}

/*
 * A draft, read with a preview token minted by an editor. Returns null for a bad or expired token
 * rather than throwing, because the API answers a bad token by falling back to published-only,
 * and a missing draft should render as not-found, not as an error page.
 */
export async function getPostPreview(slug: string, token: string): Promise<Post | null> {
    const c = await bySlugPreview("post", slug, token);
    return c ? toPost(c) : null;
}

/*
 * Filtering by a reference takes the target's id, not its slug, so an author or category page is
 * two calls: resolve the slug, then filter. Both are cached and tagged, so this costs two reads
 * once and nothing after that.
 */
async function idForSlug(type: string, slug: string): Promise<string | null> {
    const c = await bySlug(type, slug);
    return c?.id ?? null;
}

export async function listPostsBy(field: "Author" | "Category", type: string, slug: string) {
    const id = await idForSlug(type, slug);
    if (!id) return null;
    const res = await list("post", {
        pageSize: 50,
        include: ["Author", "Category"],
        filter: [[field, "eq", id]],
    });
    return res.items.map(toPost).sort(byNewest);
}

export async function getOne(type: string, slug: string) {
    const c = await bySlug(type, slug);
    if (!c) return null;
    const d = c.data;
    return {
        id: c.id,
        slug: c.slug ?? str(d.Slug),
        name: str(d.Name) || str(d.Title) || "Untitled",
        description: str(d.Description) || str(d.Bio) || undefined,
        photo: str(d.Photo) || undefined,
        website: str(d.Website) || undefined,
    };
}

export function formatDate(value?: string): string {
    if (!value) return "";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
