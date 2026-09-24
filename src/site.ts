import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import {
    SETTINGS_TYPE,
    embedHosts,
    type CollectionConfig,
    type CollectionIndexCopy,
    type CollectionReference,
    type CollectionTree,
    type FieldNames,
    type FooterColumn,
    type HeaderAction,
    HEADER_ACTION_VARIANTS,
    type Holding,
    type Home,
    type Labels,
    LABEL_KEYS,
    type OptionStyle,
    type PageSizes,
    type PressConfig,
    type Region,
    type SiteIdentity,
    type SiteRegions,
    type SiteLink,
    type SocialLink,
    type TopBar,
    type TreeProduct,
    pinnedTenant,
    TREE_LIMIT,
} from "./config.js";
import { ACTIVE_ON_MAX } from "./current-path.js";
import { readEnv } from "./env.js";
import { CmsError, isTenantHandle, list, tenantForHost } from "./delivery.js";
import { readSecret } from "./secret.js";
import { parseSiteSegment, type SiteRoute } from "./site-route.js";
import { isPluginName } from "./blocks/plugins.js";
import { presetsFrom } from "./blocks/presets.js";
import { SPACES, TONES } from "./blocks/tokens.js";
import { COLOR, FLUID_LENGTH, LENGTH, mergeColors, tokensFrom, tonesFrom } from "./theme.js";
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
 *
 * There are two ways in, and which one a page takes decides whether its render can be cached
 * (barakoPress #55):
 *
 *   from the request   `siteConfig(config)` reads the host out of the headers, exactly as above.
 *                      Reading a header makes the route dynamic, so nothing rendered is cached.
 *   from the path      `siteConfig(config, params)` reads the tenant, the gate and the host out of
 *                      the `[site]` segment the proxy rewrote to. Nothing is read from the
 *                      request, so Next stores the render under that path, and the tenant is in
 *                      the path, so two tenants cannot share an entry.
 *
 * Both stay, because a site that has not adopted the proxy keeps working: a page that calls
 * `siteConfig(config)` with no params behaves exactly as it did before #55.
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

/*
 * A page's own params, as Next hands them over. Only `site` is read, and only when it parses as a
 * segment this package's proxy wrote.
 */
export type SiteParams =
    | Record<string, unknown>
    | Promise<Record<string, unknown>>
    | undefined;

/** The route a rewritten page is being served under, or null when the page was not rewritten. */
export async function routeFromParams(params: SiteParams): Promise<SiteRoute | null> {
    if (!params) return null;
    const p = (await params) as { site?: unknown } | null | undefined;
    return parseSiteSegment(p?.site);
}

/**
 * The config for a route the proxy already resolved. Reads no header and no cookie, which is
 * what leaves the render cacheable.
 */
export async function siteFromRoute(config: PressConfig, route: SiteRoute): Promise<PressConfig> {
    const scoped: PressConfig = { ...config, tenant: route.tenant };
    return applySiteSettings(scoped, await readSettings(scoped), route.host);
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
export async function siteConfig(config: PressConfig, params?: SiteParams): Promise<PressConfig> {
    const resolved = await siteConfigOrNull(config, params);
    if (!resolved || (await showsHoldingPage(resolved, params))) notFound();
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

/**
 * True when this request gets the holding page: the tenant is holding and the request has no valid
 * session.
 *
 * A rewritten page reads the answer off its path, where the proxy put it after checking the cookie
 * once. A page that was not rewritten reads the cookie here, as it always did.
 */
export async function showsHoldingPage(config: PressConfig, params?: SiteParams): Promise<boolean> {
    if (!config.holding) return false;
    const route = await routeFromParams(params);
    if (route) return route.gate !== "shared";
    const jar = await cookies();
    return !shareCookieValid(jar.get(SHARE_COOKIE)?.value, pinnedTenant(config), shareSecret());
}

/** As `siteConfig`, but null rather than a 404, for a layout or a handler that answers for itself. */
export async function siteConfigOrNull(config: PressConfig, params?: SiteParams): Promise<PressConfig | null> {
    if (!config.sites) return config;
    const route = await routeFromParams(params);
    if (route) return siteFromRoute(config, route);
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

const BADGE_MAX = 12;

/** `activeOn`: the plain site paths in it, space separated. None readable is none at all. */
function activeOn(v: unknown): string | undefined {
    const paths = (str(v) ?? "")
        .split(/\s+/)
        .map((p) => sitePath(p))
        .filter((p): p is string => Boolean(p))
        .slice(0, ACTIVE_ON_MAX);
    return paths.length > 0 ? paths.join(" ") : undefined;
}

/** The fields every link shares. `label` and `href` may be missing; the caller drops those. */
function linkFields(item: Record<string, unknown> | undefined): Partial<SiteLink> {
    const link: Partial<SiteLink> = { label: str(item?.label), href: siteHref(item?.href) };
    const badge = str(item?.badge);
    if (badge && badge.length <= BADGE_MAX) link.badge = badge;
    if (item?.external === true) link.external = true;
    return link;
}

const complete = <T extends Partial<SiteLink>>(l: T): l is T & SiteLink => Boolean(l.label && l.href);

/*
 * `nested` is for the header and the phone menu, the two places that draw children. A child's own
 * children are never read: one level is what a dropdown can show.
 */
function links(v: unknown, max = 24, nested = false): SiteLink[] | undefined {
    return array(v)
        ?.map((item) => record(item))
        .map((item) => {
            const link = linkFields(item);
            const on = activeOn(item?.activeOn);
            if (on) link.activeOn = on;
            if (nested) {
                const children = links(item?.children, 12);
                if (children && children.length > 0) link.children = children;
            }
            return link;
        })
        .filter(complete)
        .slice(0, max);
}

/*
 * `HeaderActions`: a variant the header knows, `primary` when unset or unknown, since a call to
 * action with no say in how it looks is the main one. No `activeOn` and no children: an action is a
 * button, not a place in the site.
 */
function headerActions(v: unknown): HeaderAction[] | undefined {
    return array(v)
        ?.map((item) => record(item))
        .map((item) => {
            const named = str(item?.variant)?.toLowerCase();
            const variant = HEADER_ACTION_VARIANTS.find((x) => x === named) ?? "primary";
            return { ...linkFields(item), variant };
        })
        .filter(complete)
        .slice(0, 4);
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

/*
 * `Colors`: the theme's slots, as the tenant saved them (#49).
 *
 * Read apart from the other token groups because the palette has two names for six of its slots: the
 * role names, and the barakocms.com names those shipped under in 0.3.0. A tenant's entry holds
 * whichever it was saved with, so `mergeColors` puts the colour in both.
 */
function colorsFrom(base: ThemeColors, v: unknown): ThemeColors {
    const input = record(v);
    if (!input) return base;
    const named: Record<string, string> = {};
    for (const key of Object.keys(base)) {
        const value = str(input[key]);
        if (value && COLOR.test(value)) named[key] = value;
    }
    return mergeColors(base, named);
}

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
 * tones, built in or the tenant's own, is dropped and the region falls back to `page`.
 */
function region(base: Region | undefined, path: unknown, tone: unknown, theme: PressTheme): Region | undefined {
    const at = sitePath(path) ?? base?.path;
    if (!at) return undefined;
    const name = str(tone)?.toLowerCase();
    const known =
        name !== undefined &&
        ((TONES as readonly string[]).includes(name) || (theme.tones !== undefined && Object.hasOwn(theme.tones, name)));
    const chosen = known ? name : base?.tone;
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
function regions(base: SiteRegions | undefined, d: Record<string, unknown>, theme: PressTheme): SiteRegions | undefined {
    const header = region(base?.header, d.HeaderPath, d.HeaderTone, theme);
    const footer = region(base?.footer, d.FooterPath, d.FooterTone, theme);
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
    const keepChildren = (l: SiteLink): SiteLink => (l.children ? { ...l, children: l.children.filter(keep) } : l);
    return {
        ...site,
        topBar: site.topBar ? { ...site.topBar, links: site.topBar.links.filter(keep) } : site.topBar,
        headerLinks: site.headerLinks?.filter(keep).map(keepChildren),
        menuLinks: site.menuLinks?.filter(keep).map(keepChildren),
        headerActions: site.headerActions?.filter(keep),
        footerColumns: site.footerColumns?.map((c) => ({ ...c, links: c.links.filter(keep) })),
    };
}

/*
 * `Collections`: the content types this tenant's site renders as lists and detail pages, keyed by name,
 * each in the shape of `CollectionConfig`. An entry that does not read as one is left out whole rather
 * than half applied, and one keyed like a configured collection replaces it.
 *
 * `post`, `author` and `category` are replaceable like any other key (#44). They used to be refused,
 * because the blog factories map an entry through `types` and `fields` and a replaced `post` would
 * have rendered its list one way and its pages another. A collection carries its own field map now
 * and the post page reads it, so a school whose news lives in `article` with a `Headline` says so in
 * its settings and gets both. Every name ends up in an API query or a link, so each is held to a
 * plain identifier or a plain site path.
 */
const COLLECTION_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
const FIELD_NAME = /^@?[A-Za-z][A-Za-z0-9_]{0,62}$/;
const DATA_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const SORT = /^-?[A-Za-z][A-Za-z0-9_]{0,62}$/;
const FIELD_ROLES = [
    "slug",
    "summary",
    "body",
    "date",
    "image",
    "imageAlt",
    "featured",
    "tags",
    "url",
    "photo",
    "progress",
    "progressCount",
    "progressTotal",
    "href",
] as const;

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
    const layout = c.layout === "article" || c.layout === "list" ? c.layout : undefined;
    // Only the three values mean anything. Anything else leaves the default, which lists whatever
    // references this collection, rather than turning the band off on a typo.
    const related = c.related === "semantic" || c.related === "reference" || c.related === false ? c.related : undefined;
    const pageSize = c.pageSize;
    const noun = Array.isArray(c.noun) && c.noun.length === 2 ? [short(c.noun[0], 40), short(c.noun[1], 40)] : [];
    const indexPath = sitePath(c.indexPage);
    const indexPage = indexPath ? withoutTrailingSlashes(indexPath) : undefined;
    const defaultAuthor = short(c.defaultAuthor, 80);
    return {
        type,
        route,
        fields,
        references,
        sort: sort && SORT.test(sort) ? sort : undefined,
        feed: c.feed === true,
        sitemap: c.sitemap !== false,
        index: indexFrom(c.index),
        pageSize: typeof pageSize === "number" && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : undefined,
        label: short(c.label, 80),
        noun: noun[0] && noun[1] ? [noun[0], noun[1]] : undefined,
        colorBy: colorBy && DATA_FIELD.test(colorBy) ? colorBy : undefined,
        related,
        readingTime: c.readingTime === true,
        ...(layout ? { layout } : {}),
        ...(treeFrom(c.tree) ? { tree: treeFrom(c.tree) } : {}),
        ...(indexPage ? { indexPage } : {}),
        ...(defaultAuthor ? { defaultAuthor } : {}),
    };
}

/*
 * `index`: false turns the index off, as it always did, and anything else leaves it on. An object is
 * the index's copy (#126), each line held to a length and dropped on its own when it is not text.
 */
const INDEX_COPY_MAX: Record<keyof CollectionIndexCopy, number> = {
    eyebrow: 60,
    heading: 120,
    lede: 400,
    empty: 300,
    unavailable: 300,
};

function indexFrom(v: unknown): boolean | CollectionIndexCopy {
    if (v === false) return false;
    const input = record(v);
    if (!input) return true;
    const copy: CollectionIndexCopy = {};
    for (const [key, max] of Object.entries(INDEX_COPY_MAX) as [keyof CollectionIndexCopy, number][]) {
        const line = short(input[key], max);
        if (line) copy[key] = line;
    }
    return Object.keys(copy).length > 0 ? copy : true;
}

/*
 * `tree`: the four fields that turn a collection into a manual, plus the products the switcher offers
 * and where "edit this page" points (#23).
 *
 * Held to the same rules as everything else a tenant writes. A field name has to read as one, since it
 * goes into an API query; a product's destination goes through `siteHref`, since it goes into a link;
 * and the whole thing is dropped rather than half applied when its shape is wrong, so a typo leaves
 * the collection a flat list rather than a broken tree.
 */
const MAX_PRODUCTS = 12;
const MAX_SECTIONS = 50;

function treeFrom(v: unknown): CollectionTree | undefined {
    const t = record(v);
    if (!t) return undefined;

    const tree: CollectionTree = {};
    for (const role of ["section", "order", "parent", "editPath"] as const) {
        const names = fieldNames(t[role]);
        if (names) tree[role] = names;
    }
    // One name, because this one goes into an API filter rather than being read off an entry.
    const product = str(t.product);
    if (product && FIELD_NAME.test(product)) tree.product = product;

    const searchPath = sitePath(t.searchPath);
    if (searchPath) tree.searchPath = searchPath;

    const sections = array(t.sections)
        ?.slice(0, MAX_SECTIONS)
        .flatMap((raw) => {
            const name = short(raw, 80);
            return name ? [name] : [];
        });
    if (sections && sections.length > 0) tree.sections = sections;

    const products = array(t.products)
        ?.slice(0, MAX_PRODUCTS)
        .flatMap((raw): TreeProduct[] => {
            const p = record(raw);
            const key = short(p?.key, 64);
            const label = short(p?.label, 80);
            const href = siteHref(p?.href);
            return key && label && href ? [{ key, label, href }] : [];
        });
    if (products && products.length > 0) tree.products = products;

    const editBase = siteHref(t.editBase);
    if (editBase) tree.editBase = editBase;

    const limit = t.limit;
    if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= TREE_LIMIT) tree.limit = limit;

    return Object.keys(tree).length > 0 ? tree : undefined;
}

function collectionsFrom(base: Record<string, CollectionConfig>, v: unknown): Record<string, CollectionConfig> {
    const input = record(v);
    if (!input) return base;
    const read = Object.entries(input)
        .slice(0, 24)
        .flatMap(([key, raw]): [string, CollectionConfig][] => {
            const collection = COLLECTION_KEY.test(key) ? collectionFrom(raw) : undefined;
            return collection ? [[key, collection]] : [];
        });
    return { ...base, ...Object.fromEntries(read) };
}

/*
 * `OptionStyles` and `OptionColors`, keyed by `type.field` and then by option (#52).
 *
 * A style is a tone, an icon and a label, and a block decides what to do with them: the card draws a
 * border in the tone and a badge with the icon and the label. `OptionColors` is the same thing said
 * shorter, an option whose style is a tone and nothing else, so a tenant that saved colours keeps
 * them and a style set for the same option wins field by field.
 *
 * A tone names a colour in `Colors`, a theme slot, or a colour written out, and one that resolves to
 * nothing readable as a colour is dropped. An icon is a name the engine either draws or does not. A
 * tenant's options merge over the configured ones, so setting one option keeps the rest.
 */
const OPTION_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,62}\.[A-Za-z][A-Za-z0-9_]{0,62}$/;
const ICON_NAME = /^[a-z][a-z0-9-]{0,30}$/;
const MAX_OPTION_LABEL = 40;

/** A colour named by a `Colors` key, a theme slot, or written out. Undefined for anything else. */
function colorNamed(theme: PressTheme, colorsIn: unknown): (name: string) => string | undefined {
    const named = record(colorsIn) ?? {};
    const slots = theme.colors as unknown as Record<string, string>;
    return (name: string) => {
        const own = Object.hasOwn(named, name) ? str(named[name]) : undefined;
        if (own) return COLOR.test(own) ? own : undefined;
        if (Object.hasOwn(slots, name)) return slots[name];
        return COLOR.test(name) ? name : undefined;
    };
}

function optionStyleFrom(v: unknown, resolve: (name: string) => string | undefined): OptionStyle | undefined {
    const written = record(v);
    const tone = str(written ? written.tone : v);
    const color = tone ? resolve(tone) : undefined;
    const icon = str(written?.icon);
    const label = short(written?.label, MAX_OPTION_LABEL);
    const style: OptionStyle = {
        ...(color ? { tone: color } : {}),
        ...(icon && ICON_NAME.test(icon) ? { icon } : {}),
        ...(label ? { label } : {}),
    };
    return Object.keys(style).length > 0 ? style : undefined;
}

function optionStylesFrom(
    base: Record<string, Record<string, OptionStyle>>,
    theme: PressTheme,
    colorsIn: unknown,
    colors: unknown,
    styles: unknown,
): Record<string, Record<string, OptionStyle>> {
    const resolve = colorNamed(theme, colorsIn);
    let out = base;
    for (const input of [record(colors), record(styles)]) {
        if (!input) continue;
        const read = Object.entries(input)
            .slice(0, 50)
            .flatMap(([key, raw]): [string, Record<string, OptionStyle>][] => {
                const options = record(raw);
                if (!OPTION_KEY.test(key) || !options) return [];
                const configured = Object.hasOwn(out, key) ? out[key] : {};
                const read = Object.entries(options)
                    .slice(0, 100)
                    .flatMap(([option, value]): [string, OptionStyle][] => {
                        const style = option.length <= 200 ? optionStyleFrom(value, resolve) : undefined;
                        return style ? [[option, { ...configured[option], ...style }]] : [];
                    });
                return [[key, { ...configured, ...Object.fromEntries(read) }]];
            });
        out = { ...out, ...Object.fromEntries(read) };
    }
    return out;
}

function optionColorsFrom(
    base: Record<string, Record<string, string>>,
    theme: PressTheme,
    colorsIn: unknown,
    v: unknown,
): Record<string, Record<string, string>> {
    const input = record(v);
    if (!input) return base;
    const resolve = colorNamed(theme, colorsIn);

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

/*
 * `Labels`: the words this tenant's screens print (#47).
 *
 * One key at a time, the way a theme token merges, so a tenant that renames "min read" keeps the
 * English for everything else. A value that is not a non-empty string of reasonable length is
 * dropped and the configured word stands: a label saved empty would leave a visitor looking at a
 * blank where a word belongs.
 */
const MAX_LABEL = 400;

function labelsFrom(base: Labels, v: unknown): Labels {
    const input = record(v);
    if (!input) return base;
    const out = { ...base };
    for (const key of LABEL_KEYS) {
        const word = str(input[key]);
        if (word && word.length <= MAX_LABEL) out[key] = word;
    }
    return out;
}

/*
 * `HomePath` and `HomeCollection`: what this tenant serves at `/` (#44).
 *
 * A path names a page, the way `HoldingPath` does, and wins when both are set. A collection names a
 * key; whether the tenant has a collection under that key is settled when the page renders, since
 * the same settings entry is where the collections come from. Neither set, the root is the post
 * index, which is what it was for every site before this.
 */
function home(base: Home | undefined, d: Record<string, unknown>): Home | undefined {
    const path = sitePath(d.HomePath) ?? base?.path;
    const named = str(d.HomeCollection);
    const collection = (named && COLLECTION_KEY.test(named) ? named : undefined) ?? base?.collection;
    if (!path && !collection) return undefined;
    return { ...(path ? { path } : {}), ...(collection ? { collection } : {}) };
}

/*
 * `Plugins`: the plugin packages this tenant renders, by name (#25).
 *
 * A list replaces the configured one, and a list saved empty turns every plugin off, the way the link
 * lists clear. A name that is not a plugin name is dropped. A name the image does not carry is kept
 * and does nothing, so enabling a plugin ahead of the image that installs it is harmless.
 */
const MAX_PLUGINS = 50;

function pluginsFrom(base: string[], v: unknown): string[] {
    const listed = array(v);
    if (!listed) return base;
    return [...new Set(listed.slice(0, MAX_PLUGINS).map((raw) => str(raw)).filter(isPluginName))];
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
        headerLinks: links(d.HeaderLinks, 24, true) ?? base.headerLinks,
        menuLinks: links(d.MenuLinks, 24, true) ?? base.menuLinks,
        headerActions: headerActions(d.HeaderActions) ?? base.headerActions,
        footerColumns: footerColumns(d.FooterColumns) ?? base.footerColumns,
        socialLinks: socialLinks(d.SocialLinks) ?? base.socialLinks,
    };

    const face = fontsFrom(config.theme.fonts, config.theme.fontSources, d.Fonts);
    const colors = colorsFrom(config.theme.colors, d.Colors);
    const named = tokensFrom(config.theme.tokens, record(d.Tokens));
    const tones = tonesFrom(config.theme.tones, record(d.Tones), { colors, tokens: named });
    const theme: PressTheme = {
        colors,
        fonts: face.fonts,
        ...(face.sources ? { fontSources: face.sources } : {}),
        radii: tokens<ThemeRadii>(config.theme.radii, d.Radii, LENGTH),
        layout: tokens<ThemeLayout>(config.theme.layout, d.Layout, LENGTH),
        space: tokens<ThemeSpace>(config.theme.space, d.Space, LENGTH),
        text: tokens<ThemeText>(config.theme.text, d.Text, FLUID_LENGTH),
        asSupplied: assetsAsSupplied(config.theme.asSupplied, d, site),
        ...(named ? { tokens: named } : {}),
        ...(tones ? { tones } : {}),
    };

    const { holding: _ignored, ...rest } = config;
    void _ignored;
    const held = holding(d);
    const bands = regions(config.regions, d, theme);
    const root = home(config.home, d);
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
        plugins: pluginsFrom(config.plugins, d.Plugins),
        collections: collectionsFrom(config.collections, d.Collections),
        optionColors: optionColorsFrom(config.optionColors, theme, d.Colors, d.OptionColors),
        optionStyles: optionStylesFrom(config.optionStyles, theme, d.Colors, d.OptionColors, d.OptionStyles),
        pageSizes: pageSizesFrom(config.pageSizes, d.PageSizes),
        labels: labelsFrom(config.labels, d.Labels),
        reservedSlugs: reservedSlugsFrom(config.reservedSlugs, d.ReservedSlugs),
        ...(bands ? { regions: bands } : {}),
        ...(root ? { home: root } : {}),
        ...(held ? { holding: held } : {}),
    };
}
