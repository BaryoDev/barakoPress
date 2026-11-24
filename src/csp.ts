import { cmsUrlFor, type PressConfig } from "./config.js";
import { readEnv } from "./env.js";
import { GOOGLE_FONTS_FILES_ORIGIN, GOOGLE_FONTS_ORIGIN } from "./fonts.js";

/*
 * The Content-Security-Policy a page sends for itself.
 *
 * The Caddyfile sends a policy too, but a site run behind any other proxy had none. This one is put
 * in a `<meta>` early in the page head, so it holds wherever the image runs. It is built per
 * site, because a tenant's embed hosts and the analytics origin differ from site to site, and the
 * next.config.ts `headers()` is fixed at build time and cannot know them. The header carries only
 * the directives that never depend on a site.
 *
 * A browser ignores `frame-ancestors` in a meta tag, so that one stays in the header.
 *
 * Every value that goes in comes through `cspOrigin`: a scheme, a host and an optional port, and
 * nothing else. A setting cannot add a directive or a keyword, because a value holding a space, a
 * semicolon, a quote or a star is dropped rather than repaired.
 *
 * 'unsafe-inline' stays for scripts and styles. The renderer writes inline scripts (hydration, the
 * theme variant switch) and inline styles (every block). Nonces would need every page rendered per
 * request. That is a separate change.
 */

const LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const ORIGIN = new RegExp(`^(?<scheme>https?)://(?<host>${LABEL}(?:\\.${LABEL})*)(?::(?<port>\\d{1,5}))?$`, "i");
const MAX_ORIGIN = 280;

/**
 * `value` as a policy origin (`https://host` or `https://host:port`, lowercased), or undefined when
 * it is anything else. http is read only when `allowHttp` is true, for the CMS media origin in local
 * development.
 */
export function cspOrigin(value: unknown, allowHttp = false): string | undefined {
    if (typeof value !== "string" || value.length > MAX_ORIGIN) return undefined;
    const match = ORIGIN.exec(value);
    if (!match?.groups) return undefined;
    const scheme = match.groups.scheme.toLowerCase();
    if (scheme === "http" && !allowHttp) return undefined;
    const port = match.groups.port;
    if (port !== undefined && Number(port) > 65535) return undefined;
    return `${scheme}://${match.groups.host.toLowerCase()}${port !== undefined ? `:${port}` : ""}`;
}

/** An embed host as a setting writes it, a bare host or an https origin, as an https origin. */
function embedOrigin(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    return cspOrigin(value.includes("://") ? value : `https://${value}`);
}

function origins(values: Iterable<unknown> | undefined, read: (v: unknown) => string | undefined): string[] {
    const out = new Set<string>();
    for (const v of values ?? []) {
        const origin = read(v);
        if (origin) out.add(origin);
    }
    return [...out];
}

export interface SitePolicyInput {
    /** The hosts the site's embed block may frame. */
    embedHosts?: Iterable<string>;
    /** The origin of the analytics script the page renders, when it renders one. */
    scriptOrigins?: Iterable<string>;
    /** The origins a theme font stylesheet is linked from. */
    fontOrigins?: Iterable<string>;
    /** The CMS media origin. Only the ones https: does not already cover matter. */
    mediaOrigins?: Iterable<string>;
}

/** The per-site policy, one directive each, as a single string. */
export function sitePolicy(input: SitePolicyInput = {}): string {
    const frames = origins(input.embedHosts, embedOrigin);
    const scripts = origins(input.scriptOrigins, (v) => cspOrigin(v));
    const styles = origins(input.fontOrigins, (v) => cspOrigin(v));
    const fonts = styles.includes(GOOGLE_FONTS_ORIGIN) ? [...new Set([...styles, GOOGLE_FONTS_FILES_ORIGIN])] : styles;
    const media = origins(input.mediaOrigins, (v) => cspOrigin(v, true)).filter((o) => o.startsWith("http://"));

    const directives: [string, string[]][] = [
        ["default-src", ["'self'"]],
        ["script-src", ["'self'", "'unsafe-inline'", ...scripts]],
        ["style-src", ["'self'", "'unsafe-inline'", ...styles]],
        ["font-src", ["'self'", "data:", ...fonts]],
        ["img-src", ["'self'", "data:", "https:", ...media]],
        ["media-src", ["'self'", "https:", ...media]],
        ["connect-src", ["'self'", ...scripts]],
        ["frame-src", frames.length > 0 ? frames : ["'none'"]],
    ];
    return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** The directives that never depend on a site, for the static header in next.config.ts. */
export const STATIC_POLICY = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

/**
 * Whether a page sends its own policy. On unless `PRESS_CSP=off`, and only in production: Next's
 * development server needs eval and inline hot reload scripts a policy like this would block. Read
 * per call and never at module scope, like `PRESS_SCRIPT_ORIGINS`, so a prerender does not bake it.
 */
export function cspEnabled(env = readEnv()): boolean {
    if (env.nodeEnv !== "production") return false;
    return env.csp?.trim().toLowerCase() !== "off";
}

/**
 * `value` as an http origin a browser may load media from, or undefined. Only loopback is kept:
 * localhost, 127.0.0.1, and a name ending in `.localhost` (RFC 6761). An https origin is dropped
 * because `https:` already covers it, and so is any other scheme, any other http host and anything
 * that does not parse. What comes back is `cspOrigin` of the parsed origin, never the input.
 */
function loopbackOrigin(value: string): string | undefined {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:") return undefined;
        const host = url.hostname;
        if (!["localhost", "127.0.0.1", "[::1]"].includes(host) && !host.endsWith(".localhost")) return undefined;
        return cspOrigin(url.origin, true);
    } catch {
        return undefined;
    }
}

/**
 * The origins the media directives have to name, from the CMS address and `PRESS_MEDIA_ORIGINS`
 * (origins separated by commas or spaces). Only loopback http origins are added, by one rule for both:
 * `https:` already covers an https CMS, and the server's own URL for an http CMS, such as a compose
 * service name, is no address a browser can reach. Name the browser-facing one in
 * `PRESS_MEDIA_ORIGINS`. Read per call and never at module scope, like `PRESS_SCRIPT_ORIGINS`.
 */
export function mediaOriginsOf(
    config: Pick<PressConfig, "cmsUrl">,
    raw: string | undefined = readEnv().mediaOrigins,
): string[] {
    const out = new Set<string>();
    let cms: string | undefined;
    try {
        cms = cmsUrlFor(config);
    } catch {
        cms = undefined;
    }
    const listed = raw?.trim() ? raw.trim().split(/[\s,]+/).filter(Boolean) : [];
    for (const value of [cms, ...listed]) {
        const origin = value ? loopbackOrigin(value) : undefined;
        if (origin) out.add(origin);
    }
    return [...out];
}
