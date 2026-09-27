import type { SiteIdentity } from "./config.js";
import { readEnv } from "./env.js";

/*
 * A Umami tracking script in the page head (#179).
 *
 * A site names the script and its Umami website id, and every page renders
 * `<script defer src=... data-website-id=...>`. Both values arrive in a tenant's settings, which an
 * editor can write, and end up in a script tag in every visitor's page. So the tenant does not get to
 * decide which origins a page runs code from. The deployment does, in `PRESS_SCRIPT_ORIGINS`, read
 * per request for the reason `PRESS_FONT_ORIGINS` is.
 *
 * The default list is empty, so a deployment that sets nothing renders exactly the head it rendered
 * before this existed, whatever its tenants have saved.
 *
 * Umami only: a script URL and a website id. There is no setting that puts arbitrary HTML in the
 * head, and there should not be one.
 */

const MAX_URL = 512;
const MAX_ORIGINS = 32;

/** A host, and a port if it has one, for an allow list entry written without a scheme. */
const HOST_PORT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i;

/** A Umami website id. Nothing that could end the attribute gets through. */
const WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The script URL as a setting may carry it: absolute https, a host, no credentials, nothing that ends an attribute. */
export function analyticsScriptUrl(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const value = v.trim();
    if (!value || value.length > MAX_URL || /[\s\\<>"'`]/.test(value)) return undefined;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return undefined;
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
    return url.toString();
}

export function analyticsWebsiteId(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const value = v.trim();
    return WEBSITE_ID.test(value) ? value : undefined;
}

/*
 * Saying a script was refused, once, the way the font warnings do: the head is built on every
 * request, and a setting somebody has to fix once should not be a log line per page view.
 */
const SAID_MAX = 200;
const said = new Set<string>();

function sayOnce(message: string): void {
    if (said.has(message)) return;
    if (said.size >= SAID_MAX) said.clear();
    said.add(message);
    console.warn(message);
}

/**
 * The origins this deployment lets a page load a tracking script from, from `PRESS_SCRIPT_ORIGINS`:
 * origins separated by commas or spaces, each `https://host`, a bare host read as https. Unset or
 * blank is none.
 *
 * Read from the environment on each call and never at module scope, because a value read there is
 * baked into whatever is prerendered at build.
 */
export function allowedScriptOrigins(
    raw: string | undefined = readEnv().scriptOrigins,
): ReadonlySet<string> {
    const origins = new Set<string>();
    const written = raw?.trim();
    if (!written) return origins;

    for (const entry of written.split(/[\s,]+/).slice(0, MAX_ORIGINS)) {
        if (!entry) continue;
        const candidate = entry.includes("://") ? entry : HOST_PORT.test(entry) ? `https://${entry}` : entry;
        const href = analyticsScriptUrl(candidate);
        if (href) origins.add(new URL(href).origin);
        else sayOnce(`analytics: PRESS_SCRIPT_ORIGINS entry "${entry.slice(0, 80)}" is not an https origin, so it was dropped`);
    }
    return origins;
}

export interface AnalyticsTag {
    src: string;
    websiteId: string;
}

/**
 * The script tag's two attributes, or null when there is nothing to render: either value missing
 * or malformed, or the script's origin not on the list. Checked again here rather than trusted from
 * the settings read, because a build-time site's config reaches this without passing through it.
 */
export function analyticsTag(
    site: Pick<SiteIdentity, "analyticsScript" | "analyticsWebsiteId">,
    allowed: ReadonlySet<string>,
): AnalyticsTag | null {
    const src = analyticsScriptUrl(site.analyticsScript);
    const websiteId = analyticsWebsiteId(site.analyticsWebsiteId);
    if (!src || !websiteId) return null;
    const origin = new URL(src).origin;
    if (!allowed.has(origin)) {
        sayOnce(`analytics: the script on ${origin} is not in PRESS_SCRIPT_ORIGINS, so it was not rendered`);
        return null;
    }
    return { src, websiteId };
}
