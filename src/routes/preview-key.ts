import type { PressConfig } from "../config.js";
import { PREVIEW_COOKIE, previewKeyMatches, resolveSite } from "../site.js";

/*
 * Where a preview key is handed over while a tenant is coming soon (barakoPress #28).
 *
 *     GET /api/coming-soon?key=<key>&to=/a/path
 *
 * A valid key becomes a cookie, and every answer is a redirect to `to`, so the key leaves the address
 * bar and the history whether it was valid or not. A wrong key gets the same redirect with no cookie,
 * so this answers nothing about which keys exist. The key is never logged.
 *
 * The cookie holds the key itself, because the only thing the site can check it against is the hash
 * in the public settings entry: a cookie holding that hash would be one anyone could write. Changing
 * the hash in the settings signs every previewer out.
 */

const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** A path on this site, or `/`. Never `//host` or `/\host`, which a browser reads as another origin. */
function localPath(value: string | null): string {
    if (!value || value.length > 2048 || !value.startsWith("/")) return "/";
    if (value.startsWith("//") || value.startsWith("/\\")) return "/";
    return /^[\x21-\x7e]+$/.test(value) ? value : "/";
}

export function createPreviewKeyRoute(base: PressConfig) {
    return async function GET(request: Request): Promise<Response> {
        const config = await resolveSite(base, request.headers);
        if (!config) return new Response("Not found", { status: 404 });

        const url = new URL(request.url);
        const headers = new Headers({
            location: localPath(url.searchParams.get("to")),
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
        });
        const key = url.searchParams.get("key");
        if (config.comingSoon && previewKeyMatches(config.comingSoon, key)) {
            headers.append(
                "set-cookie",
                `${PREVIEW_COOKIE}=${key}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
            );
        }
        return new Response(null, { status: 303, headers });
    };
}
