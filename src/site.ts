import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import type {
    FooterColumn,
    Holding,
    PressConfig,
    SiteIdentity,
    SiteLink,
    SocialLink,
    TopBar,
} from "./config.js";
import { CmsError, isTenantHandle, list, tenantForHost } from "./delivery.js";
import type { PressTheme, ThemeColors, ThemeFonts, ThemeLayout, ThemeRadii } from "./theme.js";

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
 * value read there is baked into whatever is prerendered at build.
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
    if (!sites) return config.tenant ? { tenant: config.tenant, host: null } : null;

    if (config.tenant) return { tenant: config.tenant, host: null };

    if (sites.tenantHeader) {
        const named = requestHeaders.get(sites.tenantHeader)?.trim();
        if (isTenantHandle(named)) return { tenant: named, host: null };
    }

    const host = normaliseHost(requestHeaders.get(sites.hostHeader));
    if (host) {
        const tenant = await tenantForHost(config, host);
        if (tenant) return { tenant, host };
    }

    const fallback = sites.defaultTenant ?? process.env.CMS_DEFAULT_TENANT;
    return isTenantHandle(fallback) ? { tenant: fallback, host: null } : null;
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
 * HMAC-SHA256 over the tenant and that expiry, keyed with PRESS_PREVIEW_SECRET. The tenant is in the
 * signature, so a cookie made for one tenant opens no other. The cost is that revoking a link in the
 * CMS does not end a session already made from it; the 24 hour cap bounds that. Rotating the secret
 * ends every session, for every tenant at once.
 */

/** Host-only by its prefix: a browser refuses it with a Domain, without Secure, or off Path=/. */
export const SHARE_COOKIE = "__Host-press-share";

/** The longest a session made from a share link lasts, whatever the link's own expiry. */
export const SHARE_SESSION_MAX_SECONDS = 24 * 60 * 60;

/** Below this the secret is a guess away, so it counts as unset. */
const MIN_SECRET_LENGTH = 32;
const SHARE_VALUE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** PRESS_PREVIEW_SECRET, read per request. Null when unset or too short, which turns sessions off. */
export function shareSecret(): string | null {
    const secret = process.env.PRESS_PREVIEW_SECRET;
    return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
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
    return !shareCookieValid(jar.get(SHARE_COOKIE)?.value, config.tenant, shareSecret());
}

/** As `siteConfig`, but null rather than a 404, for a layout or a handler that answers for itself. */
export async function siteConfigOrNull(config: PressConfig): Promise<PressConfig | null> {
    if (!config.sites) return config;
    return resolveSite(config, await headers());
}

async function readSettings(config: PressConfig): Promise<Record<string, unknown> | undefined> {
    const type = config.sites?.settingsType;
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
            console.warn(`site: settings for tenant "${config.tenant}" could not be read (${why})`);
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

function array(v: unknown): unknown[] {
    const parsed = json(v);
    return Array.isArray(parsed) ? parsed : [];
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

function links(v: unknown, max = 24): SiteLink[] {
    return array(v)
        .map((item) => record(item))
        .map((item) => ({ label: str(item?.label), href: siteHref(item?.href) }))
        .filter((l): l is SiteLink => Boolean(l.label && l.href))
        .slice(0, max);
}

function footerColumns(v: unknown): FooterColumn[] {
    return array(v)
        .map((item) => record(item))
        .map((item) => ({ heading: str(item?.heading) ?? "", links: links(item?.links) }))
        .filter((c) => c.heading || c.links.length > 0)
        .slice(0, 8);
}

function socialLinks(v: unknown): SocialLink[] {
    return array(v)
        .map((item) => record(item))
        .map((item) => ({ network: str(item?.network), href: siteHref(item?.href) }))
        .filter((l): l is SocialLink => Boolean(l.network && l.href))
        .slice(0, 12);
}

function topBar(v: unknown): TopBar | undefined {
    const bar = record(v);
    if (!bar) return undefined;
    const text = str(bar.text);
    const barLinks = links(bar.links, 8);
    return text || barLinks.length > 0 ? { text, links: barLinks } : undefined;
}

const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]{1,60}\)|[a-z]{3,30})$/i;
const LENGTH = /^(0|\d{1,4}(\.\d{1,3})?(px|rem|em|ch|%|vw|vh))$/;
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/;

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

function fonts(base: ThemeFonts, v: unknown): ThemeFonts {
    const input = record(v);
    if (!input) return base;
    const out = { ...base };
    for (const role of ["heading", "body", "mono"] as const) {
        const family = str(input[role]);
        if (family && FAMILY.test(family)) out[role] = `'${family}', ${fallbackStack(base[role])}`;
    }
    return out;
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
    return path ? { path } : {};
}

function samePath(a: string, b: string): boolean {
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

export function applySiteSettings(
    config: PressConfig,
    data: Record<string, unknown> | undefined,
    host: string | null,
): PressConfig {
    const d = data ?? {};
    const base = config.site;

    const site: SiteIdentity = {
        name: str(d.Name) ?? (base.name || config.tenant || ""),
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
        headerLinks: d.HeaderLinks !== undefined ? links(d.HeaderLinks) : base.headerLinks,
        footerColumns: d.FooterColumns !== undefined ? footerColumns(d.FooterColumns) : base.footerColumns,
        socialLinks: d.SocialLinks !== undefined ? socialLinks(d.SocialLinks) : base.socialLinks,
    };

    const theme: PressTheme = {
        colors: tokens<ThemeColors>(config.theme.colors, d.Colors, COLOR),
        fonts: fonts(config.theme.fonts, d.Fonts),
        radii: tokens<ThemeRadii>(config.theme.radii, d.Radii, LENGTH),
        layout: tokens<ThemeLayout>(config.theme.layout, d.Layout, LENGTH),
    };

    const { holding: _ignored, ...rest } = config;
    void _ignored;
    const held = holding(d);
    return {
        ...rest,
        site: held?.path ? withoutHoldingPage(site, held.path) : site,
        theme,
        locale: locale(config.locale, d.Locale),
        ...(held ? { holding: held } : {}),
    };
}

/** The first family of each role's stack, for a site that loads its faces from Google Fonts. */
export function themeFamilies(theme: PressTheme): string[] {
    const families = [theme.fonts.heading, theme.fonts.body, theme.fonts.mono]
        .map((stack) => stack.split(",")[0].trim().replace(/^['"]|['"]$/g, ""))
        .filter((family) => FAMILY.test(family));
    return [...new Set(families)];
}
