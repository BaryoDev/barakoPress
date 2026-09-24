import { PRESS_PREFIX } from "./current-path.js";
import { isTenantHandle } from "./delivery.js";

/*
 * The path a request-time site's pages are served under (barakoPress #55).
 *
 * Before this, a page resolved its own tenant, and resolving it meant reading the request host.
 * Reading a header makes a route dynamic, and a dynamic route is never stored in Next's render
 * cache, so one container serving forty domains re-rendered every page for every visitor even
 * though every read under it was already cached and tagged.
 *
 * Next keys its render cache by the path and by nothing else. There is no `Vary` to reach for and
 * no second key to add. So whatever a render depends on has to be in the path, or the render
 * cannot be cached without being wrong. Three things are:
 *
 *   tenant  which site this is. Two tenants must never share an entry, and this is the whole of
 *           why the segment exists.
 *   gate    what the visitor may see: the public site, or the site behind a share link. A cached
 *           render made for one must never answer the other.
 *   host    the host the tenant was found by. It is the site's origin when the tenant's settings
 *           leave `Url` empty, so two hosts on one tenant are two renders, not one.
 *
 * They go in one segment rather than three, so the app tree a consumer writes is one directory
 * deep: `app/_press/[site]/...`. `~` separates them because a tenant handle and a host can hold
 * neither it nor each other's characters.
 *
 * The `_press` prefix is not decoration. Without it a bare `/<tenant>/<gate>/...` tree would be
 * reachable from outside, and `https://one-tenant.example/other-tenant/public/` would render the
 * other tenant's site on this tenant's domain. The proxy refuses an incoming path under the
 * prefix, so the only way into the tree is a rewrite it made itself.
 */

export { PRESS_PREFIX };

/**
 * What the visitor may see: everyone, or someone carrying a valid share session, for whom a holding
 * tenant shows the real site instead of the holding page.
 *
 * A draft is not a gate. `?preview=` is read from the query, and a route that reads the query is a
 * route Next will not keep, so a preview route leaves `generateStaticParams` out of its own file
 * and stays dynamic. Putting the token in the path instead would cache a draft, which is the one
 * thing a preview must never be.
 */
export const GATES = ["public", "shared"] as const;
export type Gate = (typeof GATES)[number];

export interface SiteRoute {
    tenant: string;
    gate: Gate;
    /** The host the tenant was found by, or null when a pin, a header or the default chose it. */
    host: string | null;
}

/** Stands in for a host in the segment, so the three parts are always three. */
const NO_HOST = "-";

/** What `normaliseHost` can produce, checked again because this arrives as a route parameter. */
const HOST = /^[a-z0-9][a-z0-9.-]{0,252}$/;

export function siteSegment(route: SiteRoute): string {
    return `${route.tenant}~${route.gate}~${route.host ?? NO_HOST}`;
}

/** The route a segment names, or null when it is not one this built. */
export function parseSiteSegment(value: unknown): SiteRoute | null {
    if (typeof value !== "string") return null;
    const parts = value.split("~");
    if (parts.length !== 3) return null;
    const [tenant, gate, host] = parts;
    if (!isTenantHandle(tenant)) return null;
    if (!(GATES as readonly string[]).includes(gate)) return null;
    if (host !== NO_HOST && !HOST.test(host)) return null;
    return { tenant, gate: gate as Gate, host: host === NO_HOST ? null : host };
}

/** Where a request for `pathname` is served from. */
export function pressPath(route: SiteRoute, pathname: string): string {
    const rest = pathname === "/" ? "" : pathname;
    return `/${PRESS_PREFIX}/${siteSegment(route)}${rest}`;
}

/** True for a path only a rewrite may produce. One that arrives from outside is a 404. */
export function isPressPath(pathname: string): boolean {
    return pathname === `/${PRESS_PREFIX}` || pathname.startsWith(`/${PRESS_PREFIX}/`);
}

/*
 * What the proxy leaves alone.
 *
 * The route handlers and the metadata files answer for themselves and resolve their own tenant:
 * `sitemap.ts` and `robots.ts` have to sit at the root of the app tree, so neither can carry a
 * tenant segment, and a route handler cannot read one anyway. `/_share` and the redeem route are
 * per visitor by definition.
 *
 * A path whose last segment holds a dot is left for the static handler, because `public/logo.png`
 * is served from the root and a rewrite of it is a 404. The cost is that a page cannot be served
 * at a path ending in a dotted segment, which is the trade a file tree and a page tree sharing
 * one namespace always makes.
 */
const NOT_REWRITTEN = new Set([
    "api",
    "_next",
    "_share",
    "%5fshare",
    "feed.xml",
    "sitemap.xml",
    "robots.txt",
    "favicon.ico",
]);

export function isRewritten(pathname: string): boolean {
    const first = pathname.split("/")[1]?.toLowerCase() ?? "";
    if (NOT_REWRITTEN.has(first)) return false;
    const last = pathname.slice(pathname.lastIndexOf("/") + 1);
    return !last.includes(".");
}
