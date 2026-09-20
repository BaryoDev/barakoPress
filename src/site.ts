import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import {
    AUTHOR_COLLECTION,
    CATEGORY_COLLECTION,
    POST_COLLECTION,
    SETTINGS_TYPE,
    embedHosts,
    type CollectionConfig,
    type CollectionReference,
    type FieldNames,
    type FooterColumn,
    type Holding,
    type PageSizes,
    type PressConfig,
    type Region,
    type SiteIdentity,
    type SiteRegions,
    type SiteLink,
    type SocialLink,
    type TopBar,
    pinnedTenant,
} from "./config.js";
import { readEnv } from "./env.js";
import { CmsError, isTenantHandle, list, tenantForHost } from "./delivery.js";
import { readSecret } from "./secret.js";
import { presetsFrom } from "./blocks/presets.js";
import { SPACES, TONES, type ToneName } from "./blocks/tokens.js";
import type {
    PressTheme,
    SuppliedAsset,
    ThemeColors,
    ThemeFontSources,
    ThemeFonts,
    ThemeLayout,
    ThemeRadii,
    ThemeSpace,
    ThemeText,
} from "./theme.js";
import { FONT_FAMILY, FONT_ROLES, fontStylesheetHref } from "./fonts.js";

/*
 * Request-time sites: one build, many domains (barakoCMS D22, barakoPress #20).
 *
 * A build-time site (no `sites` in its config) never reaches past the first line of any function
 * here: it gets its own config back, nothing reads the request, and nothing is fetched. That is
 * what keeps a site built from press.config.ts identity working as it did.
 *
 * A request-time site resolves, on every request:
 *
 *   1. the tenant: pinned by `tenant` (CMS_TENANT), else an operator-named tenant header, else the
 *      host through GET /api/tenants/by-host/{host}, else the configured default, else none;
 *   2. that tenant's site settings, the one published entry of the `site` type;
 *   3. a config whose identity, theme, locale and tenant are that tenant's.
 *
 * Every read after that carries the tenant in its header, its cache tag and its fallback key. No
 * tenant means a 404, never another tenant's site. Nothing here is read at module scope, because a
 * value read there is baked into whatever is prerendered at build. Every environment value comes
 * through `readEnv` (barakoPress #51).
 */

/** The host a request named, lowercased, without a port or a trailing dot. Null if it is not a DNS name. */
export function normaliseHost(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const host = raw.trim().toLowerCase().replace(/:\d{1,5}$/, "").replace(/\.$/, "");
    if (host.length === 0 || host.length > 253) return null;
    const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
    return host.split(".").every((part) => label.test(part)) ? host : null;
}

export interface ResolvedTenant {
    tenant: string;
    /** The host the tenant was found by. Null when it came from a pin, a header or the default. */
    host: string | null;
}

/**
 * Which tenant this request belongs to, or null for none.
 *
 * The handle is only ever taken from the request through a header the operator named. A host is
 * taken from the request, but only as a question for the CMS, whose answer is the handle.
 */
export async function tenantFromHeaders(
    config: PressConfig,
    requestHeaders: Headers,
): Promise<ResolvedTenant | null> {
    const sites = config.sites;
    const env = readEnv();
    const pinned = pinnedTenant(config, env);
    if (!sites) return pinned ? { tenant: pinned, host: null } : null;

    if (pinned) return { tenant: pinned, host: null };

    if (sites.tenantHeader) {
        const named = requestHeaders.get(sites.tenantHeader)?.trim();
        if (isTenantHandle(named)) return { tenant: named, host: null };
    }

    const host = normaliseHost(requestHeaders.get(sites.hostHeader));
    if (host) {
        const tenant = await tenantForHost(config, host);
        if (tenant) return { tenant, host };
    }

    const fallback = sites.defaultTenant ?? env.defaultTenant;
    return isTenantHandle(fallback) ? { tenant: fallback, host: null } : null;
}

/**
 * The request headers that pick the tenant beyond what the URL names, as a `Vary` value. Null when the
 * URL is enough: a build-time site, or one that reads the tenant from `host` alone.
 */
export function tenantVary(config: PressConfig): string | null {
    const sites = config.sites;
    if (!sites) return null;
    const named = [sites.tenantHeader, sites.hostHeader === "host" ? undefined : sites.hostHeader];
    const vary = named.filter((h): h is string => Boolean(h));
    return vary.length > 0 ? vary.join(", ") : null;
}

/** The config a request renders with, or null when the request belongs to no tenant. */
export async function resolveSite(
    config: PressConfig,
    requestHeaders: Headers,
): Promise<PressConfig | null> {
    if (!config.sites) return config;

    const found = await tenantFromHeaders(config, requestHeaders);
    if (!found) return null;

    const scoped: PressConfig = { ...config, tenant: found.tenant };
    return applySiteSettings(scoped, await readSettings(scoped), found.host);
}

/**
 * The config for this request in a server component or route handler.
 *
 * A request with no tenant is a not-found, and so is one the tenant's holding mode holds back.
 * That second one is what keeps a page's content and its metadata out of the response: the page
 * stops here, before it reads anything, and the layout renders the holding page in its place.
 */
export async function siteConfig(config: PressConfig): Promise<PressConfig> {
    const resolved = await siteConfigOrNull(config);
    if (!resolved || (await showsHoldingPage(resolved))) notFound();
    return resolved;
}

/*
 * Holding mode and site share links (barakoPress #28).
 *
 * Whether a request gets the holding page is decided per request from the cookie and the tenant's
 * settings, and is never part of anything cached: the settings read is the same for every visitor,
 * and reading the cookie makes the render dynamic. So a visitor without a session cannot be handed a
 * render made for one with it, or the reverse.
 *
 * barakoCMS checks a share link once, when it is redeemed. What that check buys is a cookie this
 * process can verify on every later request without asking the CMS again: an expiry and an
 * HMAC-SHA256 over the tenant and that expiry, keyed with PRESS_SECRET. The tenant is in the
 * signature, so a cookie made for one tenant opens no other. The cost is that revoking a link in the
 * CMS does not end a session already made from it; the 24 hour cap bounds that. Rotating the secret
 * ends every session, for every tenant at once.
 */

/** Host-only by its prefix: a browser refuses it with a Domain, without Secure, or off Path=/. */
export const SHARE_COOKIE = "__Host-press-share";

/** The longest a session made from a share link lasts, whatever the link's own expiry. */
export const SHARE_SESSION_MAX_SECONDS = 24 * 60 * 60;

const SHARE_VALUE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/**
 * PRESS_SECRET, else PRESS_PREVIEW_SECRET, read per request. Null when unset or shorter than
 * MIN_SECRET_LENGTH, which turns sessions off.
 */
export function shareSecret(): string | null {
    const secret = readSecret("press-share");
    return secret && !secret.short ? secret.value : null;
}

function shareSignature(tenant: string, expires: number, secret: string): Buffer {
    return createHmac("sha256", secret).update(`press-share.${tenant}.${expires}`).digest();
}

/** The cookie value for a tenant: `<expiry in unix seconds>.<base64url HMAC>`. */
export function signShareCookie(tenant: string, expires: number, secret: string): string {
    return `${expires}.${shareSignature(tenant, expires, secret).toString("base64url")}`;
}

/** Whether a cookie value was signed with this secret for this tenant and has not expired. */
export function shareCookieValid(
    value: string | null | undefined,
    tenant: string | undefined,
    secret: string | null,
    now: number = Date.now(),
): boolean {
    if (!secret || !tenant || typeof value !== "string") return false;
    const m = SHARE_VALUE.exec(value);
    if (!m) return false;
    const expires = Number(m[1]);
    if (expires * 1000 <= now) return false;
    // A signed expiry past the cap was not made here, whatever the signature says.
    if (expires * 1000 > now + SHARE_SESSION_MAX_SECONDS * 1000 + 60_000) return false;
    const actual = Buffer.from(m[2], "base64url");
    const expected = shareSignature(tenant, expires, secret);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** True when this request gets the holding page: the tenant is holding and the request has no valid session. */
export async function showsHoldingPage(config: PressConfig): Promise<boolean> {
    if (!config.holding) return false;
    const jar = await cookies();
    return !shareCookieValid(jar.get(SHARE_COOKIE)?.value, pinnedTenant(config), shareSecret());
}

/** As `siteConfig`, but null rather than a 404, for a layout or a handler that answers for itself. */
export async function siteConfigOrNull(config: PressConfig): Promise<PressConfig | null> {
    if (!config.sites) return config;
    return resolveSite(config, await headers());
}

/**
 * The tenant's site settings entry as it is stored, or an empty object when there is none. Every value
 * in it was typed by an editor, so a caller checks the shape of whatever it reads.
 */
export async function getGlobals(config: PressConfig): Promise<Record<string, unknown>> {
    // The read below swallows its own failures, so a config nobody resolved has to be refused here.
    if (config.sites && !pinnedTenant(config)) throw new Error("a request-time site has to be resolved before it reads");
    return (await readSettings(config, config.sites?.settingsType ?? SETTINGS_TYPE)) ?? {};
}

async function readSettings(
    config: PressConfig,
    type: string | undefined = config.sites?.settingsType,
): Promise<Record<string, unknown> | undefined> {
    if (!type) return undefined;
    try {
        const res = await list(config, type, { pageSize: 1 });
        return res.items[0]?.data;
    } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        // No settings type in this tenant is a site that has not been set up yet, and a failed read
        // with nothing kept is an outage. Both render with the configured identity and theme rather
        // than failing the page (#14: fall back to the configured theme, not to the defaults).
        if (!(e instanceof CmsError && e.status === 404)) {
            const why = e instanceof Error ? e.message : String(e);
            console.warn(`site: settings for tenant "${pinnedTenant(config) ?? ""}" could not be read (${why})`);
        }
        return undefined;
    }
}

/*
 * Mapping the stored settings onto a config. Everything in them was typed by an editor, so every
 * value is checked for shape and anything unreadable is left at the configured value. A half-filled
 * theme renders rather than breaks, and nothing here can put markup or a script URL into a page.
 */

const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

/** A JSON field may arrive as a parsed value or as the text an editor saved. */
function json(v: unknown): unknown {
    if (typeof v !== "string") return v;
    try {
        return JSON.parse(v);
    } catch {
        return undefined;
    }
}

function record(v: unknown): Record<string, unknown> | undefined {
    const parsed = json(v);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
}

/** Undefined when the field is not a list, so the caller keeps the configured one. */
function array(v: unknown): unknown[] | undefined {
    const parsed = json(v);
    return Array.isArray(parsed) ? parsed : undefined;
}

/** A path on the site, or an absolute http or https URL. Anything else is dropped. */
export function siteHref(v: unknown): string | undefined {
    const value = str(v);
    if (!value || /[\s\\<>"']/.test(value)) return undefined;
    if (value.startsWith("/")) return value.startsWith("//") ? undefined : value;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
    } catch {
        return undefined;
    }
}

/** Drops trailing slashes without a regular expression, which CodeQL flags as slow on long runs of '/'. */
function withoutTrailingSlashes(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
    return value.slice(0, end);
}

function origin(v: unknown): string | undefined {
    const href = siteHref(v);
    return href && !href.startsWith("/") ? withoutTrailingSlashes(href) : undefined;
}

function links(v: unknown, max = 24): SiteLink[] | undefined {
    return array(v)
        ?.map((item) => record(item))
        .map((item) => ({ label: str(item?.label), href: siteHref(item?.href) }))
        .filter((l): l is SiteLink => Boolean(l.label && l.href))
        .slice(0, max);
}

function footerColumns(v: unknown): FooterColumn[] | undefined {
    return array(v)
        ?.map((item) => record(item))
        .map((item) => ({ heading: str(item?.heading) ?? "", links: links(item?.links) ?? [] }))
        .filter((c) => c.heading || c.links.length > 0)
        .slice(0, 8);
}

function socialLinks(v: unknown): SocialLink[] | undefined {
    return array(v)
        ?.map((item) => record(item))
        .map((item) => ({ network: str(item?.network), href: siteHref(item?.href) }))
        .filter((l): l is SocialLink => Boolean(l.network && l.href))
        .slice(0, 12);
}

function topBar(v: unknown): TopBar | undefined {
    const bar = record(v);
    if (!bar) return undefined;
    const text = str(bar.text);
    const barLinks = links(bar.links, 8) ?? [];
    return text || barLinks.length > 0 ? { text, links: barLinks } : undefined;
}

const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]{1,60}\)|[a-z]{3,30})$/i;
const LENGTH = /^(0|\d{1,4}(\.\d{1,3})?(px|rem|em|ch|%|vw|vh))$/;

function tokens<T extends object>(base: T, v: unknown, valid: RegExp): T {
    const input = record(v);
    if (!input) return base;
    const out = { ...base };
    for (const key of Object.keys(base) as (keyof T & string)[]) {
        const value = str(input[key]);
        if (value && valid.test(value)) (out as Record<string, unknown>)[key] = value;
    }
    return out;
}

/** What follows the first family in a stack, so a site's own face keeps the configured fallbacks. */
function fallbackStack(stack: string): string {
    const comma = stack.indexOf(",");
    return comma === -1 ? "sans-serif" : stack.slice(comma + 1).trim();
}

/*
 * `Fonts`: a family name per role, and the stylesheet that loads it when the site does not want
 * Google Fonts (#54).
 *
 *   "Fonts": { "heading": "Zilla Slab", "body": { "family": "Inter", "url": "https://type.school.example/inter.css" } }
 *
 * A role the tenant names is the tenant's, family and stylesheet together: a family set with no url
 * clears a configured one rather than leaving the page loading a stylesheet for a face it no longer
 * uses. A role the tenant leaves out keeps both.
 *
 * A url is kept only if it is an absolute https URL. Whether it is ever linked is a separate
 * question, answered against the deployment's allow list when the head is built, because the
 * environment is not readable at module scope and this runs wherever settings are applied.
 */
function fontsFrom(
    base: ThemeFonts,
    baseSources: ThemeFontSources | undefined,
    v: unknown,
): { fonts: ThemeFonts; sources: ThemeFontSources | undefined } {
    const input = record(v);
    if (!input) return { fonts: base, sources: baseSources };

    const out = { ...base };
    const sources: ThemeFontSources = { ...baseSources };
    for (const role of FONT_ROLES) {
        const entry = input[role];
        if (entry === undefined || entry === null) continue;
        const spec = record(entry);
        const family = str(spec ? spec.family : entry);
        const href = spec ? fontStylesheetHref(spec.url ?? spec.href) : undefined;
        if (family && FONT_FAMILY.test(family)) {
            out[role] = `'${family}', ${fallbackStack(base[role])}`;
            if (href) sources[role] = href;
            else delete sources[role];
        } else if (href) {
            sources[role] = href;
        }
    }
    return { fonts: out, sources: Object.keys(sources).length > 0 ? sources : undefined };
}

function locale(base: string, v: unknown): string {
    const value = str(v);
    if (!value || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/.test(value)) return base;
    try {
        return Intl.DateTimeFormat.supportedLocalesOf(value).length > 0 ? value : base;
    } catch {
        return base;
    }
}

/** A path on this site for a page: `/` and segments, no query, fragment, backslash or `//`. */
function sitePath(v: unknown): string | undefined {
    const value = str(v);
    if (!value || value.length > 512 || !value.startsWith("/") || value.startsWith("//")) return undefined;
    return /^\/[A-Za-z0-9._~\/-]*$/.test(value) ? value : undefined;
}

/** `Mode: "Holding"` holds the site. Unset, `Live` or anything else is live. */
function holding(d: Record<string, unknown>): Holding | undefined {
    if (str(d.Mode)?.toLowerCase() !== "holding") return undefined;
    const path = sitePath(d.HoldingPath);
    const message = str(d.HoldingMessage);
    return { ...(path ? { path } : {}), ...(message ? { message } : {}) };
}

/*
 * A block region from its two settings: the page path and the tone behind it (#48).
 *
 * The two merge over the configured region one at a time, the way `Tagline` and `Logo` do, so a
 * tenant that sets only a tone keeps the configured path and gets its own tone. A path that is not
 * a plain site path leaves the configured one, and no path at all leaves the region unset, so the
 * built-in header or footer renders rather than nothing. A tone that is not one of the theme's
 * tones is dropped and the region falls back to `page`.
 */
function region(base: Region | undefined, path: unknown, tone: unknown): Region | undefined {
    const at = sitePath(path) ?? base?.path;
    if (!at) return undefined;
    const name = str(tone)?.toLowerCase();
    const known = name !== undefined && (TONES as readonly string[]).includes(name);
    const chosen = known ? (name as ToneName) : base?.tone;
    return { path: at, ...(chosen ? { tone: chosen } : {}) };
}

/*
 * The assets this tenant uses exactly as supplied (#29).
 *
 * `AssetsAsSupplied` is a list of URLs, or of `{ url, clearSpace }` for one that needs more room
 * than the default. `LogoAsSupplied` is the common case said once: the logo and the footer logo,
 * with `LogoClearSpace` around them, so a tenant that replaces its logo file does not have to
 * remember a second setting naming the old one.
 *
 * A list saved empty clears the configured one, the way every other list here does. An entry whose
 * URL is not a site path or an http URL is dropped rather than half applied.
 */
function clearSpaceName(v: unknown): string | undefined {
    const name = str(v)?.toLowerCase();
    return name && (SPACES as readonly string[]).includes(name) ? name : undefined;
}

function asset(url: string | undefined, clearSpace: string | undefined): SuppliedAsset[] {
    if (!url) return [];
    return [{ url, ...(clearSpace ? { clearSpace } : {}) }];
}

function assetsAsSupplied(
    base: readonly SuppliedAsset[],
    d: Record<string, unknown>,
    site: SiteIdentity,
): readonly SuppliedAsset[] {
    const listed = array(d.AssetsAsSupplied)?.flatMap((entry) => {
        const written = record(entry);
        return written
            ? asset(siteHref(written.url), clearSpaceName(written.clearSpace))
            : asset(siteHref(entry), undefined);
    });
    const logoSpace = clearSpaceName(d.LogoClearSpace);
    const logos =
        d.LogoAsSupplied === true ? [...asset(site.logo, logoSpace), ...asset(site.footerLogo, logoSpace)] : [];
    return [...(listed ?? base), ...logos].slice(0, 24);
}

/** The tenant's regions, each merged over the configured one. */
function regions(base: SiteRegions | undefined, d: Record<string, unknown>): SiteRegions | undefined {
    const header = region(base?.header, d.HeaderPath, d.HeaderTone);
    const footer = region(base?.footer, d.FooterPath, d.FooterTone);
    if (!header && !footer) return undefined;
    return { ...(header ? { header } : {}), ...(footer ? { footer } : {}) };
}

export function samePath(a: string, b: string): boolean {
    const trim = (p: string) => withoutTrailingSlashes(p).toLowerCase() || "/";
    return trim(a) === trim(b);
}

/** The path a link opens on this site, or null when it goes elsewhere. */
function localPathOf(href: string, siteUrl: string): string | null {
    try {
        const url = new URL(href, siteUrl || "http://site.invalid");
        const base = siteUrl ? new URL(siteUrl).origin : "http://site.invalid";
        return url.origin === base ? url.pathname : null;
    } catch {
        return null;
    }
}

/*
 * While holding, a link to the holding page leaves the header, the top bar and the footer. Someone
 * browsing the real site through a share link would otherwise find the page that stands in for it.
 */
function withoutHoldingPage(site: SiteIdentity, path: string): SiteIdentity {
    const keep = (l: SiteLink) => {
        const local = localPathOf(l.href, site.url);
        return local === null || !samePath(local, path);
    };
    return {
        ...site,
        topBar: site.topBar ? { ...site.topBar, links: site.topBar.links.filter(keep) } : site.topBar,
        headerLinks: site.headerLinks?.filter(keep),
        footerColumns: site.footerColumns?.map((c) => ({ ...c, links: c.links.filter(keep) })),
    };
}

/*
 * `Collections`: the content types this tenant's site renders as lists and detail pages, keyed by name,
 * each in the shape of `CollectionConfig`. An entry that does not read as one is left out whole rather
 * than half applied, and one keyed like a configured collection replaces it. The blog's own three keys
 * are refused: the blog factories map posts through `types` and `fields`, so a replaced `post` entry
 * would render its list one way and its pages another. Every name ends up in an
 * API query or a link, so each is held to a plain identifier or a plain site path.
 */
const COLLECTION_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const BLOG_KEYS = new Set([POST_COLLECTION, AUTHOR_COLLECTION, CATEGORY_COLLECTION]);
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
const FIELD_NAME = /^@?[A-Za-z][A-Za-z0-9_]{0,62}$/;
const DATA_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const SORT = /^-?[A-Za-z][A-Za-z0-9_]{0,62}$/;
const FIELD_ROLES = ["slug", "summary", "body", "date", "image", "imageAlt", "featured", "tags", "url"] as const;

function fieldNames(v: unknown): FieldNames | undefined {
    if (typeof v === "string") return FIELD_NAME.test(v) ? v : undefined;
    if (!Array.isArray(v) || v.length === 0 || v.length > 5) return undefined;
    return v.every((n) => typeof n === "string" && FIELD_NAME.test(n)) ? (v as string[]) : undefined;
}

function short(v: unknown, max: number): string | undefined {
    const s = str(v);
    return s && s.length <= max ? s : undefined;
}

function collectionFrom(v: unknown): CollectionConfig | undefined {
    const c = record(v);
    const fieldsIn = record(c?.fields);
    const type = str(c?.type);
    const title = fieldNames(fieldsIn?.title);
    if (!c || !fieldsIn || !type || !TYPE_NAME.test(type) || !title) return undefined;

    let route: string | undefined;
    if (c.route !== undefined) {
        const path = sitePath(c.route);
        route = path ? withoutTrailingSlashes(path) : undefined;
        if (!route) return undefined;
    }

    const fields: CollectionConfig["fields"] = { title };
    for (const role of FIELD_ROLES) {
        const names = fieldNames(fieldsIn[role]);
        if (names) fields[role] = names;
    }

    const references = Object.fromEntries(
        Object.entries(record(c.references) ?? {})
            .slice(0, 5)
            .flatMap(([field, raw]): [string, CollectionReference][] => {
                const ref = typeof raw === "string" ? { collection: raw } : record(raw);
                const target = str(ref?.collection);
                if (!DATA_FIELD.test(field) || !target || !COLLECTION_KEY.test(target)) return [];
                return [[field, { collection: target, label: short(ref?.label, 40), inFeed: ref?.inFeed === true }]];
            }),
    );

    const sort = str(c.sort);
    const colorBy = str(c.colorBy);
    const pageSize = c.pageSize;
    const noun = Array.isArray(c.noun) && c.noun.length === 2 ? [short(c.noun[0], 40), short(c.noun[1], 40)] : [];
    return {
        type,
        route,
        fields,
        references,
        sort: sort && SORT.test(sort) ? sort : undefined,
        feed: c.feed === true,
        sitemap: c.sitemap !== false,
        index: c.index !== false,
        pageSize: typeof pageSize === "number" && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : undefined,
        label: short(c.label, 80),
        noun: noun[0] && noun[1] ? [noun[0], noun[1]] : undefined,
        colorBy: colorBy && DATA_FIELD.test(colorBy) ? colorBy : undefined,
    };
}

function collectionsFrom(base: Record<string, CollectionConfig>, v: unknown): Record<string, CollectionConfig> {
    const input = record(v);
    if (!input) return base;
    const read = Object.entries(input)
        .slice(0, 24)
        .flatMap(([key, raw]): [string, CollectionConfig][] => {
            const collection = COLLECTION_KEY.test(key) && !BLOG_KEYS.has(key) ? collectionFrom(raw) : undefined;
            return collection ? [[key, collection]] : [];
        });
    return { ...base, ...Object.fromEntries(read) };
}

/*
 * `OptionColors`, keyed by `type.field` and then by option, each naming a colour in `Colors`, a theme
 * slot, or a colour written out. A name that resolves to nothing readable as a colour is dropped. The
 * tenant's options merge over the configured ones, so setting one option keeps the rest.
 */
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,62}\.[A-Za-z][A-Za-z0-9_]{0,62}$/;

function optionColorsFrom(
    base: Record<string, Record<string, string>>,
    theme: PressTheme,
    colorsIn: unknown,
    v: unknown,
): Record<string, Record<string, string>> {
    const input = record(v);
    if (!input) return base;
    const named = record(colorsIn) ?? {};
    const slots = theme.colors as unknown as Record<string, string>;
    const resolve = (name: string): string | undefined => {
        const own = Object.hasOwn(named, name) ? str(named[name]) : undefined;
        if (own) return COLOR.test(own) ? own : undefined;
        if (Object.hasOwn(slots, name)) return slots[name];
        return COLOR.test(name) ? name : undefined;
    };

    const read = Object.entries(input)
        .slice(0, 50)
        .flatMap(([key, raw]): [string, Record<string, string>][] => {
            const options = record(raw);
            if (!OPTION_KEY.test(key) || !options) return [];
            const colors = Object.entries(options)
                .slice(0, 100)
                .flatMap(([option, name]): [string, string][] => {
                    const colorName = str(name);
                    const color = option.length <= 200 && colorName ? resolve(colorName) : undefined;
                    return color ? [[option, color]] : [];
                });
            const configured = Object.hasOwn(base, key) ? base[key] : {};
            return [[key, { ...configured, ...Object.fromEntries(colors) }]];
        });
    return { ...base, ...Object.fromEntries(read) };
}

/*
 * `PageSizes`: how many items this tenant's index, feed, sitemap and archive ask for (#53).
 *
 * One image serves every tenant, so a count written in press.config.ts is the same count for all of
 * them: a bakery wanting 50 products and an agency wanting 9 case studies both got 20. The four keys
 * merge one at a time, the way a theme token does, so a tenant that sets `index` keeps the configured
 * feed size. A value that is not a whole number in range is dropped and the configured one stands.
 *
 * The ceiling is the largest number the config ships (`sitemap`, 1000). It is not a promise of rows:
 * barakoCMS clamps a public list at 100 whatever is asked for, so a bigger number here buys nothing
 * and is refused only when it is obviously not a page size.
 */
const PAGE_SIZE_KEYS = ["index", "feed", "sitemap", "archive"] as const;
const MAX_PAGE_SIZE = 1000;

function pageSizesFrom(base: PageSizes, v: unknown): PageSizes {
    const input = record(v);
    if (!input) return base;
    const out = { ...base };
    for (const key of PAGE_SIZE_KEYS) {
        const size = input[key];
        if (typeof size === "number" && Number.isInteger(size) && size >= 1 && size <= MAX_PAGE_SIZE) out[key] = size;
    }
    return out;
}

/*
 * `ReservedSlugs`: first path segments a root-mounted page may not take, added to the configured
 * ones (#53).
 *
 * Additive only, and that is the design rather than a shortcut. The configured list is the app's own
 * routes and the engine's own files, so a tenant that could drop one would put a page on a path Next
 * resolves to a route file first, and the page would render nowhere while looking fine in the menu.
 * What a tenant can add is what sits in front of its own domain: a proxy answering /shop or /status
 * is a per-domain fact, not a per-image one, and reserving it keeps that path out of the menu and the
 * sitemap instead of linking somewhere this site never serves. So an empty list keeps the configured
 * slugs here, where everywhere else in this file an empty list clears.
 *
 * A tenant's collection routes need no entry: `isReservedPath` reads them off the resolved config.
 */
const RESERVED_SLUG = /^[A-Za-z0-9._~-]{1,64}$/;
const MAX_RESERVED_SLUGS = 50;

function reservedSlugsFrom(base: string[], v: unknown): string[] {
    const listed = array(v);
    if (!listed) return base;
    const added = listed.slice(0, MAX_RESERVED_SLUGS).flatMap((raw) => {
        const written = str(raw);
        if (!written) return [];
        const slug = withoutTrailingSlashes(written.startsWith("/") ? written.slice(1) : written).toLowerCase();
        return RESERVED_SLUG.test(slug) ? [slug] : [];
    });
    return [...new Set([...base, ...added])];
}

export function applySiteSettings(
    config: PressConfig,
    data: Record<string, unknown> | undefined,
    host: string | null,
): PressConfig {
    const d = data ?? {};
    const base = config.site;

    const site: SiteIdentity = {
        name: str(d.Name) ?? (base.name || pinnedTenant(config) || ""),
        tagline: str(d.Tagline) ?? base.tagline,
        // A host is only a fallback origin when the CMS said it belongs to this tenant.
        url: origin(d.Url) ?? (base.url || (host ? `https://${host}` : "")),
        logo: siteHref(d.Logo) ?? base.logo,
        logoAlt: str(d.LogoAlt) ?? base.logoAlt,
        footerLogo: siteHref(d.FooterLogo) ?? base.footerLogo,
        favicon: siteHref(d.Favicon) ?? base.favicon,
        shareImage: siteHref(d.ShareImage) ?? base.shareImage,
        copyright: str(d.Copyright) ?? base.copyright,
        topBar: topBar(d.TopBar) ?? base.topBar,
        // A list saved empty clears the configured one. A field that is not a list keeps it.
        headerLinks: links(d.HeaderLinks) ?? base.headerLinks,
        footerColumns: footerColumns(d.FooterColumns) ?? base.footerColumns,
        socialLinks: socialLinks(d.SocialLinks) ?? base.socialLinks,
    };

    const face = fontsFrom(config.theme.fonts, config.theme.fontSources, d.Fonts);
    const theme: PressTheme = {
        colors: tokens<ThemeColors>(config.theme.colors, d.Colors, COLOR),
        fonts: face.fonts,
        ...(face.sources ? { fontSources: face.sources } : {}),
        radii: tokens<ThemeRadii>(config.theme.radii, d.Radii, LENGTH),
        layout: tokens<ThemeLayout>(config.theme.layout, d.Layout, LENGTH),
        space: tokens<ThemeSpace>(config.theme.space, d.Space, LENGTH),
        text: tokens<ThemeText>(config.theme.text, d.Text, LENGTH),
        asSupplied: assetsAsSupplied(config.theme.asSupplied, d, site),
    };

    const { holding: _ignored, ...rest } = config;
    void _ignored;
    const held = holding(d);
    const bands = regions(config.regions, d);
    return {
        ...rest,
        site: held?.path ? withoutHoldingPage(site, held.path) : site,
        theme,
        locale: locale(config.locale, d.Locale),
        ...(str(d.Currency) && /^[A-Za-z]{3}$/.test(str(d.Currency) as string)
            ? { currency: (str(d.Currency) as string).toUpperCase() }
            : {}),
        embedHosts: embedHosts(array(d.EmbedHosts) as string[] | undefined) ?? config.embedHosts,
        // A tenant's named blocks. Saved in barakoBrew, so anything that is not a preset is left
        // out rather than half applied, the same as every other setting.
        presets: array(d.Presets) ? presetsFrom(array(d.Presets), pinnedTenant(config)) : config.presets,
        collections: collectionsFrom(config.collections, d.Collections),
        optionColors: optionColorsFrom(config.optionColors, theme, d.Colors, d.OptionColors),
        pageSizes: pageSizesFrom(config.pageSizes, d.PageSizes),
        reservedSlugs: reservedSlugsFrom(config.reservedSlugs, d.ReservedSlugs),
        ...(bands ? { regions: bands } : {}),
        ...(held ? { holding: held } : {}),
    };
}
