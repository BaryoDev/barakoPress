import type { PressConfig } from "./config.js";

/*
 * The delivery layer: typed calls against barakoCMS's public API.
 *
 * It should use @baryodev/barako-client and it is written to switch back, but 0.3.0 cannot express
 * what a blog needs. Its PublicListQuery is `{ page?, pageSize? }` and nothing else, and `bySlug`
 * takes no options, so `include`, `filter`, `sort` and a preview token are all out of reach even
 * though the API supports every one of them. Tracked on BaryoDev/barakoCMS#182.
 *
 * Caching is the reason to be careful here. Every read is tagged, so a signed webhook can drop it
 * the moment the CMS says something changed, and carries a backstop so a deployment whose webhook
 * was never wired up still refreshes on its own.
 *
 * Nothing here reads process.env or a module-level constant: every call takes the config, because
 * two sites served by one build must be able to differ, and because a value read at module scope
 * is baked into a prerender at build time.
 */

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

export interface Paged<T> {
    items: T[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
}

function headers(config: PressConfig): HeadersInit {
    return config.tenant ? { "X-Tenant": config.tenant } : {};
}

/** A cached, tagged read. Everything a visitor sees comes through here. */
async function get<T>(config: PressConfig, path: string): Promise<T> {
    const res = await fetch(`${config.cmsUrl}${path}`, {
        headers: headers(config),
        next: {
            tags: [config.cacheTag],
            // Zero means no backstop, which Next spells as false.
            revalidate: config.backstopSeconds > 0 ? config.backstopSeconds : false,
        },
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
}

/** An uncached read, for a draft. A cached draft would be served to the next visitor. */
async function getFresh<T>(config: PressConfig, path: string): Promise<T | null> {
    const res = await fetch(`${config.cmsUrl}${path}`, {
        headers: headers(config),
        cache: "no-store",
    });
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
    /** Sent to the API, so ordering covers every row rather than the page that came back. */
    sort?: string;
}

export async function list(
    config: PressConfig,
    type: string,
    opts: ListOptions = {},
): Promise<Paged<PublicContent>> {
    const q = new URLSearchParams();
    q.set("page", String(opts.page ?? 1));
    q.set("pageSize", String(opts.pageSize ?? config.pageSizes.index));
    if (opts.include?.length) q.set("include", opts.include.join(","));
    if (opts.sort) q.set("sort", opts.sort);
    for (const [field, op, value] of opts.filter ?? []) q.set(`filter[${field}][${op}]`, value);
    return get<Paged<PublicContent>>(config, `/api/public/${encodeURIComponent(type)}?${q}`);
}

export async function bySlug(
    config: PressConfig,
    type: string,
    slug: string,
): Promise<PublicContent | null> {
    try {
        return await get<PublicContent>(
            config,
            `/api/public/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`,
        );
    } catch (e) {
        // A missing entry is a not-found page, not a broken site.
        if (e instanceof Error && e.message.includes("404")) return null;
        throw e;
    }
}

/**
 * A draft, read with a preview token an editor minted from `POST /api/preview`.
 *
 * An invalid or expired token is not an error: the API falls back to published-only, so this
 * returns whatever is public, or null. That is the safe direction to fail in.
 */
export async function bySlugPreview(
    config: PressConfig,
    type: string,
    slug: string,
    token: string,
): Promise<PublicContent | null> {
    return getFresh<PublicContent>(
        config,
        `/api/public/${encodeURIComponent(type)}/${encodeURIComponent(slug)}?preview=${encodeURIComponent(token)}`,
    );
}

/*
 * Semantic search, from the optional BarakoCMS.AI module.
 *
 * Optional is the whole design constraint. A CMS without the module answers 404 on this route, a
 * type that is not publicly deliverable answers 404, and a module installed but not enabled
 * answers 200 with an empty list, because it ships inert until `Ai:Enabled`. All three are normal
 * and none of them is an error, so this returns an empty list for every one of them rather than
 * throwing. A post page must not fail because a module the site never installed is not there.
 */
export interface SemanticHit {
    contentType: string;
    /** Nullable in the API. A hit with no slug is not linkable, so callers drop it. */
    slug?: string;
    title: string;
    /** Cosine similarity, rounded to 4 decimals by the API. Anything under 0.4 is already dropped. */
    score: number;
}

export interface SemanticResponse {
    results: SemanticHit[];
    count: number;
    query: string;
}

/** The API clamps this itself. It is repeated here so a caller asking for 50 sends a legal request. */
const MAX_SEMANTIC_LIMIT = 20;

export async function semantic(
    config: PressConfig,
    type: string,
    query: string,
    limit: number,
): Promise<SemanticHit[]> {
    const q = query.trim();
    // The API answers empty under two characters. Not spending a request to be told that.
    if (q.length < 2) return [];

    const params = new URLSearchParams({
        q,
        limit: String(Math.max(1, Math.min(limit, MAX_SEMANTIC_LIMIT))),
    });

    try {
        const res = await get<SemanticResponse>(
            config,
            `/api/public/${encodeURIComponent(type)}/semantic?${params}`,
        );
        return Array.isArray(res.results) ? res.results : [];
    } catch {
        return [];
    }
}
