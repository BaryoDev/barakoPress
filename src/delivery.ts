import { isIP } from "node:net";
import { cmsUrlFor, pinnedTenant, type PressConfig } from "./config.js";
import { readEnv } from "./env.js";

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
 * Nothing here holds a module-level constant, and nothing reads the environment at module scope:
 * every call takes the config, because two sites served by one build must be able to differ, and
 * because a value read at module scope is baked into a prerender at build time. Where the CMS is
 * and which tenant a call carries come from `cmsUrlFor` and `pinnedTenant`, which put the config
 * first and read `CMS_URL` and `CMS_TENANT` on the call that needs them (barakoPress #51).
 *
 * Every call to the CMS is bounded by `cmsTimeoutMs`, the redemption below included. A visitor
 * waiting on a share link is waiting on a CMS call like any other, and an operator who lowers the
 * timeout for a slow network meant that one too.
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

/** A CMS answer that was not a success. The message keeps the form callers already match on. */
export class CmsError extends Error {
    constructor(
        readonly path: string,
        readonly status: number,
    ) {
        super(`${path} answered ${status}`);
    }
}

function headers(config: PressConfig): HeadersInit {
    const tenant = pinnedTenant(config);
    return tenant ? { "X-Tenant": tenant } : {};
}

/**
 * The cache tag a read carries and the webhook purges.
 *
 * A build-time site keeps its one configured tag. A request-time site adds the tenant, so one
 * tenant's publish drops only that tenant's reads. A request-time config with no tenant has not
 * been resolved, and reading with it would store an answer no tenant owns, so that refuses.
 */
export function cacheTagFor(config: PressConfig): string {
    if (!config.sites) return config.cacheTag;
    const tenant = pinnedTenant(config);
    if (!tenant) throw new Error("a request-time site has to be resolved before it reads");
    return `${config.cacheTag}:${tenant}`;
}

/*
 * The last good answer per read, for a request-time site only.
 *
 * baryo.dev moved onto the shared renderer on the condition that a brief API outage does not take
 * it down (barakoCMS D22). Next's data cache cannot promise that: a purge expires the entry, and the
 * next read then blocks on a CMS that is not there. So every successful read is kept here, keyed by
 * CMS, tenant and path, and a read that fails for a reason worth retrying answers from it instead.
 * The next successful read replaces it.
 *
 * The tenant is in the key, and that is the property that matters: tenant b asking for a path
 * tenant a has cached gets a's answer never, and an error if it has none of its own.
 *
 * Bounded by the characters held, oldest out first, so a site with a large sitemap cannot grow the
 * process without limit. In-process, like the cache it backs.
 */
const STALE_MAX_CHARS = 32 * 1024 * 1024;
const stale = new Map<string, string>();
let staleChars = 0;

function remember(key: string, text: string) {
    const old = stale.get(key);
    if (old !== undefined) {
        staleChars -= old.length;
        stale.delete(key);
    }
    if (text.length > STALE_MAX_CHARS) return;
    stale.set(key, text);
    staleChars += text.length;
    for (const [k, v] of stale) {
        if (staleChars <= STALE_MAX_CHARS) break;
        stale.delete(k);
        staleChars -= v.length;
    }
}

/*
 * When a read last failed, per kept answer. Until this has passed, the read answers from the kept copy
 * without asking the CMS, so during an outage a purged page costs one request every few seconds and
 * not one per visitor, each waiting out the timeout. Only a key with a kept answer gets a marker, and
 * the map is capped like the host map.
 */
const FAILED_READ_TTL_MS = 10_000;
const FAILED_MAX = 1000;
const failedAt = new Map<string, number>();

function markFailed(key: string) {
    failedAt.delete(key);
    failedAt.set(key, Date.now());
    while (failedAt.size > FAILED_MAX) failedAt.delete(failedAt.keys().next().value as string);
}

/** For tests: forget every kept answer, failed read and host lookup. */
export function forgetCachedReads() {
    stale.clear();
    staleChars = 0;
    failedAt.clear();
    hosts.clear();
}

/** A failure the last good answer may stand in for. A 404 or a 400 is an answer, not an outage. */
function worthServingStale(e: unknown): boolean {
    if (e instanceof CmsError) return e.status >= 500 || e.status === 408 || e.status === 429;
    // Next signals its own control flow (dynamic usage, not found) with errors that carry a digest.
    // Those are not outages and must keep travelling.
    return !(e && typeof e === "object" && "digest" in e);
}

interface ReadOptions {
    headers: HeadersInit;
    tag: string;
    /** Set for a request-time site. The key the last good answer is kept under. */
    staleKey?: string;
}

async function read<T>(config: PressConfig, path: string, opts: ReadOptions): Promise<T> {
    if (opts.staleKey) {
        const at = failedAt.get(opts.staleKey);
        const kept = stale.get(opts.staleKey);
        if (at !== undefined && kept !== undefined) {
            if (Date.now() - at < FAILED_READ_TTL_MS) return JSON.parse(kept) as T;
            // This request asks the CMS again. Renewed before the fetch, so the visitors who arrive while
            // it waits out a hung CMS keep answering from the copy instead of each waiting too.
            markFailed(opts.staleKey);
        }
    }
    try {
        const res = await fetch(`${cmsUrlFor(config)}${path}`, {
            headers: opts.headers,
            signal: AbortSignal.timeout(config.cmsTimeoutMs),
            next: {
                tags: [opts.tag],
                // Zero means no backstop, which Next spells as false.
                revalidate: config.backstopSeconds > 0 ? config.backstopSeconds : false,
            },
        });
        if (!res.ok) throw new CmsError(path, res.status);
        const text = await res.text();
        const value = JSON.parse(text) as T;
        if (opts.staleKey) {
            remember(opts.staleKey, text);
            failedAt.delete(opts.staleKey);
        }
        return value;
    } catch (e) {
        const kept = opts.staleKey ? stale.get(opts.staleKey) : undefined;
        if (kept === undefined || !worthServingStale(e)) throw e;
        markFailed(opts.staleKey!);
        const why = e instanceof Error ? e.message : String(e);
        console.warn(`cms: ${path} for tenant "${pinnedTenant(config) ?? ""}" failed (${why}), serving the last good answer`);
        return JSON.parse(kept) as T;
    }
}

/** A cached, tagged read. Everything a visitor sees comes through here. */
async function get<T>(config: PressConfig, path: string): Promise<T> {
    const env = readEnv();
    return read<T>(config, path, {
        headers: headers(config),
        tag: cacheTagFor(config),
        staleKey: config.sites ? `${cmsUrlFor(config, env)}|t:${pinnedTenant(config, env)}|${path}` : undefined,
    });
}

/** An uncached read, for a draft. A cached draft would be served to the next visitor. */
async function getFresh<T>(config: PressConfig, path: string): Promise<T | null> {
    const res = await fetch(`${cmsUrlFor(config)}${path}`, {
        headers: headers(config),
        cache: "no-store",
        signal: AbortSignal.timeout(config.cmsTimeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new CmsError(path, res.status);
    return (await res.json()) as T;
}

/*
 * Which tenant a host belongs to.
 *
 * Answers are held in process for a minute rather than in Next's data cache, because the host is
 * whatever a caller put in the request: a data cache entry per invented host is disk anyone can
 * fill. This map is bounded instead, and an unknown host is remembered as unknown for the same
 * minute so a flood of one name costs one lookup.
 *
 * A known host keeps its answer past the minute, so when the lookup fails the site still resolves.
 * An unknown one never does: failing closed there is a 404, not someone else's site.
 */
const HOST_TTL_MS = 60_000;
const HOSTS_MAX = 1000;
const hosts = new Map<string, { tenant: string | null; at: number }>();
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

export function isTenantHandle(value: string | null | undefined): value is string {
    return typeof value === "string" && HANDLE.test(value);
}

export async function tenantForHost(config: PressConfig, host: string): Promise<string | null> {
    const known = hosts.get(host);
    if (known && Date.now() - known.at < HOST_TTL_MS) return known.tenant;

    const path = `/api/tenants/by-host/${encodeURIComponent(host)}`;
    let tenant: string | null;
    try {
        const res = await fetch(`${cmsUrlFor(config)}${path}`, { cache: "no-store", signal: AbortSignal.timeout(config.cmsTimeoutMs) });
        if (res.status === 404) tenant = null;
        else if (!res.ok) throw new CmsError(path, res.status);
        else {
            const body = (await res.json()) as { handle?: unknown };
            tenant = typeof body.handle === "string" && isTenantHandle(body.handle) ? body.handle : null;
        }
    } catch (e) {
        if (known?.tenant && worthServingStale(e)) {
            console.warn(`cms: tenant lookup for ${host} failed, keeping "${known.tenant}"`);
            // Kept for another minute, so an outage costs one lookup a minute per host, not one a request.
            hosts.set(host, { tenant: known.tenant, at: Date.now() });
            return known.tenant;
        }
        throw e;
    }

    hosts.delete(host);
    hosts.set(host, { tenant, at: Date.now() });
    while (hosts.size > HOSTS_MAX) hosts.delete(hosts.keys().next().value as string);
    return tenant;
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
        if (e instanceof CmsError ? e.status === 404 : e instanceof Error && e.message.includes("404"))
            return null;
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

/**
 * The BarakoCMS.Pages body contracts this renderer reads. The module puts `contract` in every body and
 * moves it only on a breaking change, so a body outside this range is read as absent: no menu, no
 * page. A public site should not refuse to render because a menu shape moved.
 */
export const PAGES_CONTRACT = { min: 1, max: 1 } as const;

export function speaksPagesContract(contract: unknown): boolean {
    return (
        typeof contract === "number" &&
        Number.isInteger(contract) &&
        contract >= PAGES_CONTRACT.min &&
        contract <= PAGES_CONTRACT.max
    );
}

function warnContract(config: PressConfig, what: string, contract: unknown) {
    console.warn(
        `pages: ${what} for tenant "${pinnedTenant(config) ?? ""}" speaks contract ${String(contract)}, this renderer reads ${PAGES_CONTRACT.min} to ${PAGES_CONTRACT.max}`,
    );
}

/** What `GET /api/public/pages/resolve` answers. Everything past `contract` is checked by the caller. */
export interface ResolvedPage {
    contract: number;
    path: string;
    entry: PublicContent;
    breadcrumbs?: unknown;
}

/**
 * The published page at a site path, from the Pages module. Null when nothing is served there, when
 * the module is not installed (also a 404), or when the body speaks a contract this does not know.
 */
export async function pageAtPath(config: PressConfig, path: string): Promise<ResolvedPage | null> {
    try {
        const res = await get<ResolvedPage>(config, `/api/public/pages/resolve?${new URLSearchParams({ path })}`);
        if (!res || typeof res !== "object") return null;
        if (!speaksPagesContract(res.contract)) {
            warnContract(config, `the page at ${path}`, res.contract);
            return null;
        }
        // An entry without its data would throw in toPage, and that is a 500 for a body that is only malformed.
        const entry = res.entry as Partial<PublicContent> | null | undefined;
        return entry && typeof entry === "object" && entry.data && typeof entry.data === "object" && !Array.isArray(entry.data)
            ? res
            : null;
    } catch (e) {
        if (e instanceof CmsError && e.status === 404) return null;
        throw e;
    }
}

/**
 * The menu tree from `GET /api/public/pages/navigation`, unchecked past its contract. Null when the
 * module is not installed or the body speaks a contract this does not know.
 */
export async function navigationTree(config: PressConfig): Promise<{ contract: number; items: unknown } | null> {
    try {
        const res = await get<{ contract: number; items: unknown }>(config, "/api/public/pages/navigation");
        if (!res || typeof res !== "object") return null;
        if (!speaksPagesContract(res.contract)) {
            warnContract(config, "navigation", res.contract);
            return null;
        }
        return res;
    } catch (e) {
        if (e instanceof CmsError && e.status === 404) return null;
        throw e;
    }
}

/** What `GET /api/public/redirects/resolve` answers, unchecked. Null when nothing moved (a 404). */
export async function redirectAt(
    config: PressConfig,
    path: string,
): Promise<{ fromPath?: unknown; toPath?: unknown; status?: unknown } | null> {
    try {
        return await get(config, `/api/public/redirects/resolve?${new URLSearchParams({ path })}`);
    } catch (e) {
        if (e instanceof CmsError && e.status === 404) return null;
        throw e;
    }
}

export type ShareRedeemAnswer =
    | { kind: "valid"; expiresAt: number }
    | { kind: "invalid" }
    | { kind: "throttled" }
    | { kind: "failed" };

/** Who is redeeming, so barakoCMS can rate limit the visitor rather than the renderer's own address. */
export interface ShareRedeemCaller {
    /** `CMS_RENDERER_KEY`. barakoCMS trusts the visitor IP only when this matches its own. */
    rendererKey?: string;
    /** The visitor's IP address. Anything but exactly one IP literal is dropped. */
    visitorIp?: string;
}

/** One IPv4 or IPv6 literal, or null. A list, a port, a zone or anything else is not an address. */
export function singleIp(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value || value.length > 45 || value.includes("%")) return null;
    return isIP(value) === 0 ? null : value;
}

/**
 * Redeems a site share link with barakoCMS: `POST /api/public/site/share-links/redeem`, 200 with
 * `{ expiresAt }` for a link that is valid now, 404 otherwise, 429 when throttled.
 *
 * One uncached request, never retried, since a retry would spend the caller's throttle allowance.
 * It is bounded by `cmsTimeoutMs` like every other CMS call: a visitor is waiting on the answer, and
 * a slow redemption is a failed one (barakoPress #51).
 * The key goes in the body, not the URL, so no access log records it. Nothing here logs it either.
 * A 200 whose expiry is missing, unreadable or already past counts as a failure: there is nothing
 * safe to sign. A redirect is refused rather than followed, because a 307 or 308 would send the key
 * on to wherever it points. The renderer key rides along for the same reason, and is never logged.
 */
export async function redeemShareLink(
    config: PressConfig,
    key: string,
    now: number = Date.now(),
    caller: ShareRedeemCaller = {},
): Promise<ShareRedeemAnswer> {
    const sent: Record<string, string> = { ...(headers(config) as Record<string, string>), "content-type": "application/json" };
    if (caller.rendererKey) sent["X-Barako-Renderer-Key"] = caller.rendererKey;
    const visitorIp = singleIp(caller.visitorIp);
    if (visitorIp) sent["X-Barako-Visitor-IP"] = visitorIp;
    try {
        const res = await fetch(`${cmsUrlFor(config)}/api/public/site/share-links/redeem`, {
            method: "POST",
            headers: sent,
            body: JSON.stringify({ key }),
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(config.cmsTimeoutMs),
        });
        if (res.status === 404) return { kind: "invalid" };
        if (res.status === 429) return { kind: "throttled" };
        if (res.status !== 200) return { kind: "failed" };
        const body = (await res.json()) as { expiresAt?: unknown };
        const expiresAt = typeof body?.expiresAt === "string" ? Date.parse(body.expiresAt) : Number.NaN;
        return Number.isFinite(expiresAt) && expiresAt > now ? { kind: "valid", expiresAt } : { kind: "failed" };
    } catch {
        return { kind: "failed" };
    }
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
