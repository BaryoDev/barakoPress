/*
 * The delivery layer: typed calls against barakoCMS's public API.
 *
 * This was going to use @baryodev/barako-client, and it should, but 0.3.0 cannot express what this
 * site needs. Its PublicListQuery is `{ page?, pageSize? }` and nothing else, and `bySlug` takes no
 * options at all. So three of the things every blog does are out of reach through it:
 *
 *   include=Author,Category   resolving a reference, so a post card can name its author without
 *                             one extra request per post
 *   filter[Author][eq]=id     an author or category archive
 *   ?preview=<token>          rendering a draft
 *
 * All three are supported by the API and documented. The gap is the client's, and it is filed.
 * When the client can express them, this file should shrink to a thin mapping layer and the
 * transport should go back to being someone else's problem. Writing it here is the compromise, not
 * the intent: a starter that keeps its own client is how a project ends up with two.
 *
 * Caching is the reason this is worth doing carefully. Every read below is tagged and cached with
 * no expiry, so ordinary traffic never reaches Postgres, and app/api/revalidate drops the tag when
 * the CMS says something changed.
 */

export const CMS_TAG = "cms";

const baseUrl = (process.env.CMS_URL ?? process.env.NEXT_PUBLIC_CMS_URL ?? "http://localhost:5005").replace(
    /\/$/,
    "",
);
const tenant = process.env.CMS_TENANT || undefined;

export interface PublicContent {
    id: string;
    slug?: string;
    contentType?: string;
    createdAt?: string;
    updatedAt?: string;
    data: Record<string, unknown>;
    seo?: Seo;
}

export interface Seo {
    title?: string;
    description?: string;
    canonicalUrl?: string;
    imageUrl?: string;
    noIndex?: boolean;
}

interface Paged<T> {
    items: T[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
}

function headers(): HeadersInit {
    return tenant ? { "X-Tenant": tenant } : {};
}

/** A cached, tagged read. Everything a visitor sees comes through here. */
async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
        headers: headers(),
        next: { tags: [CMS_TAG], revalidate: false },
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
}

/** An uncached read, for a draft. A cached draft would be served to the next visitor. */
async function getFresh<T>(path: string): Promise<T | null> {
    const res = await fetch(`${baseUrl}${path}`, { headers: headers(), cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
}

export interface ListOptions {
    page?: number;
    pageSize?: number;
    /** Reference fields to resolve in the same request. The API caps this at five. */
    include?: string[];
    /** `[field, op, value]`, for example ["Author", "eq", id]. The API caps this at five. */
    filter?: [string, string, string][];
    sort?: string;
}

export async function list(type: string, opts: ListOptions = {}): Promise<Paged<PublicContent>> {
    const q = new URLSearchParams();
    q.set("page", String(opts.page ?? 1));
    q.set("pageSize", String(opts.pageSize ?? 20));
    if (opts.include?.length) q.set("include", opts.include.join(","));
    if (opts.sort) q.set("sort", opts.sort);
    for (const [field, op, value] of opts.filter ?? []) q.set(`filter[${field}][${op}]`, value);
    return get<Paged<PublicContent>>(`/api/public/${encodeURIComponent(type)}?${q}`);
}

export async function bySlug(type: string, slug: string): Promise<PublicContent | null> {
    try {
        return await get<PublicContent>(
            `/api/public/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`,
        );
    } catch (e) {
        // A missing entry is a 404, which is a not-found page, not a broken site.
        if (e instanceof Error && e.message.includes("404")) return null;
        throw e;
    }
}

/**
 * A draft, read with a preview token an editor minted from `POST /api/preview`.
 *
 * An invalid or expired token is not an error: the API silently falls back to published-only, so
 * this returns whatever is public, or null. That is the safe direction to fail in.
 */
export async function bySlugPreview(
    type: string,
    slug: string,
    token: string,
): Promise<PublicContent | null> {
    return getFresh<PublicContent>(
        `/api/public/${encodeURIComponent(type)}/${encodeURIComponent(slug)}?preview=${encodeURIComponent(token)}`,
    );
}
