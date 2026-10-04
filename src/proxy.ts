import { NextResponse, type NextRequest } from "next/server";
import type { PressConfig } from "./config.js";
import {
    isPressPath,
    isRewritten,
    pressLinkPath,
    pressPath,
    PRESS_PREFIX,
    type Gate,
    type SiteRoute,
} from "./site-route.js";
import { LINK_COOKIE, openLinkCookie, samePath, SHARE_COOKIE, shareCookieValid, shareSecret, tenantFromHeaders } from "./site.js";

/*
 * The one place a request-time site reads the request (barakoPress #55).
 *
 * It answers the two questions that used to be asked again on every page, in the render, where
 * asking them cost the render its place in Next's cache:
 *
 *   which tenant is this?   the host, through the CMS, exactly as `tenantFromHeaders` always did.
 *   what may they see?      the share cookie, checked once here rather than once per component.
 *
 * Both answers go in the path, and the pages read them from there. A host the CMS does not know is
 * a 404 before anything renders, so an invented host never makes a cache entry: only a host a
 * tenant owns can put one there.
 *
 * The answer carries `Cache-Control: private, no-store`, which is what a request-time site has
 * always sent. Next's render cache is the server's own and is not this header, so the render is
 * still cached here; what stays true is that nothing between this server and the visitor may keep
 * a copy. That matters most for the gate: a browser or a proxy holding `/` would otherwise be
 * holding one visitor's answer for a URL that answers differently for the next one.
 */

function gateFor(request: NextRequest, tenant: string): Gate {
    const cookie = request.cookies.get(SHARE_COOKIE)?.value;
    return shareCookieValid(cookie, tenant, shareSecret()) ? "shared" : "public";
}

/** The path as the visitor asked for it, decoded the way a link's path is written. */
function decodedPath(pathname: string): string {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return pathname;
    }
}

/*
 * True when the visitor holds a link to one entry or one page, for this tenant, and is on the path it
 * opens at. Only that path goes to the link route; every other path is the site as this visitor
 * would otherwise see it.
 */
function opensLink(request: NextRequest, tenant: string, pathname: string): boolean {
    const link = openLinkCookie(request.cookies.get(LINK_COOKIE)?.value, tenant, shareSecret());
    return link !== null && samePath(link.path, decodedPath(pathname));
}

/**
 * A path nothing serves, so Next answers its own 404 without any tenant having rendered.
 *
 * Built from the request's origin rather than cloned from `nextUrl`, which carries the incoming
 * path's trailing slash over and would leave the refusal looking like a segment.
 */
function noTenant(request: NextRequest): NextResponse {
    return withHeaders(NextResponse.rewrite(new URL(`/${PRESS_PREFIX}`, request.url)));
}

function withHeaders(res: NextResponse): NextResponse {
    res.headers.set("cache-control", "private, no-store");
    return res;
}

/**
 * What a request-time site puts in its own `proxy.ts`, the file Next 16 renamed from `middleware`:
 *
 *     import { createPressProxy } from "barakopress";
 *     import { config } from "@/press.config";
 *
 *     export default createPressProxy(config);
 *
 * There is no matcher to write: Next refuses route segment config in a proxy file, and the skip
 * list is this package's own anyway. A proxy always runs on Node, which is what `node:crypto` in
 * the share cookie check and the CMS lookup need.
 *
 * A build-time site does not need it and gets a pass-through if it adds one anyway.
 */
export function createPressProxy(config: PressConfig) {
    return async function pressProxy(request: NextRequest): Promise<NextResponse> {
        const { pathname } = request.nextUrl;
        // Only a rewrite may reach the tenant tree. Letting one in from outside would serve any
        // tenant's site on any tenant's domain, which is the failure this whole shape exists to
        // make impossible.
        if (isPressPath(pathname)) return noTenant(request);
        if (!config.sites || !isRewritten(pathname)) return NextResponse.next();

        let found: { tenant: string; host: string | null } | null;
        try {
            found = await tenantFromHeaders(config, request.headers);
        } catch (e) {
            // A lookup that failed is not a tenant. Answering 404 is the same thing the render did
            // when it could not resolve, and it is the answer that cannot be another tenant's site.
            const why = e instanceof Error ? e.message : String(e);
            console.warn(`site: the tenant for this request could not be resolved (${why})`);
            return noTenant(request);
        }
        if (!found) return noTenant(request);

        const url = request.nextUrl.clone();
        if (opensLink(request, found.tenant, pathname)) {
            url.pathname = pressLinkPath({ tenant: found.tenant, gate: "link", host: found.host }, pathname);
            const res = withHeaders(NextResponse.rewrite(url));
            // What a link opens may be a draft: no index, and no address handed on to another site.
            res.headers.set("x-robots-tag", "noindex, nofollow");
            res.headers.set("referrer-policy", "no-referrer");
            return res;
        }
        const route: SiteRoute = { tenant: found.tenant, gate: gateFor(request, found.tenant), host: found.host };
        url.pathname = pressPath(route, pathname);
        return withHeaders(NextResponse.rewrite(url));
    };
}
