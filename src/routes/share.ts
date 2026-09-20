import type { Labels, PressConfig } from "../config.js";
import { readEnv } from "../env.js";
import { redeemShareLink } from "../delivery.js";
import { normaliseHost, resolveSite, SHARE_COOKIE, SHARE_SESSION_MAX_SECONDS, shareSecret, signShareCookie } from "../site.js";

/*
 * Site share links (barakoPress #28).
 *
 * A client is given `{site Url}/_share#{key}`. The key is in the fragment, so it never reaches a
 * server log, a proxy or a referrer. Two routes take it from there:
 *
 *   GET  /_share             a tiny page whose script moves the fragment into a form, drops it
 *                            from history and posts it. No key in any URL.
 *   POST /api/share/redeem   asks barakoCMS once. A valid link becomes a signed session cookie and
 *                            a 303 to `/`. Anything else sets nothing and lands on the holding page
 *                            at `/#share-invalid`, which shows a short notice.
 *
 * The key is read from the body only, never the query string, and never logged.
 */

/** The fragment the holding page shows its "not valid or has expired" notice for. */
export const SHARE_INVALID_FRAGMENT = "share-invalid";

const KEY = /^[\x21-\x7e]{16,512}$/;
const MAX_BODY_BYTES = 4096;

const NO_STORE = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
} as const;

export interface SharePageOptions {
    /** Where the redeem route is mounted. Defaults to `/api/share/redeem`. */
    redeemPath?: string;
}

function redirect(location: string, cookie?: string): Response {
    const headers = new Headers({ ...NO_STORE, location });
    if (cookie) headers.append("set-cookie", cookie);
    return new Response(null, { status: 303, headers });
}

const refused = () => redirect(`/#${SHARE_INVALID_FRAGMENT}`);

/*
 * A form post from another site could otherwise start a session in a visitor's browser with a link
 * someone else holds. A browser sends Origin on a form post and Sec-Fetch-Site on every request, so
 * either one naming another site is refused. A caller that sends neither is not a browser, and gets
 * no more than redeeming the key it already has.
 */
function sameOrigin(request: Request, hostHeader: string): boolean {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return false;
    const origin = request.headers.get("origin");
    if (origin === null) return true;
    try {
        return normaliseHost(new URL(origin).host) === normaliseHost(request.headers.get(hostHeader));
    } catch {
        return false;
    }
}

/*
 * The visitor's address, for barakoCMS to rate limit by. It is read only from a header the operator
 * named, the same trust as the host and tenant headers: a proxy in front sets it and strips a
 * caller's value. A route handler is never given the socket's address, and the X-Forwarded-For Next
 * adds keeps whatever a caller sent, so with no header named nothing is sent.
 */
function visitorIp(config: PressConfig, request: Request): string | undefined {
    const named = config.sites?.visitorIpHeader;
    return named ? (request.headers.get(named) ?? undefined) : undefined;
}

async function readKey(request: Request): Promise<string | null> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return null;
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    let key: unknown;
    if (type.startsWith("application/x-www-form-urlencoded")) {
        key = new URLSearchParams(raw).get("key");
    } else if (type.startsWith("application/json")) {
        try {
            key = (JSON.parse(raw) as { key?: unknown })?.key;
        } catch {
            key = undefined;
        }
    }
    return typeof key === "string" && KEY.test(key) ? key : null;
}

export function createShareRedeemRoute(base: PressConfig) {
    return async function POST(request: Request): Promise<Response> {
        const config = await resolveSite(base, request.headers);
        if (!config) return new Response("Not found", { status: 404, headers: NO_STORE });
        if (!sameOrigin(request, config.sites?.hostHeader ?? "host")) return refused();

        // A live site has nothing to open, so the link is not spent on it.
        if (!config.holding || !config.tenant) return redirect("/");

        const key = await readKey(request);
        if (!key) return refused();

        const secret = shareSecret();
        if (!secret) {
            console.warn("share links: PRESS_SECRET (else PRESS_PREVIEW_SECRET) is unset or shorter than 32 characters, so no session can be issued");
            return refused();
        }

        const now = Date.now();
        const answer = await redeemShareLink(config, key, now, {
            rendererKey: readEnv().rendererKey?.trim() || undefined,
            visitorIp: visitorIp(config, request),
        });
        if (answer.kind !== "valid") return refused();

        const expires = Math.floor(Math.min(answer.expiresAt, now + SHARE_SESSION_MAX_SECONDS * 1000) / 1000);
        const maxAge = expires - Math.floor(now / 1000);
        if (maxAge <= 0) return refused();
        return redirect(
            "/",
            `${SHARE_COOKIE}=${signShareCookie(config.tenant, expires, secret)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
        );
    };
}

/** Every word below is a tenant's to set, so each one is escaped into the markup it lands in. */
function escape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function html(redeemPath: string, labels: Labels, locale: string): string {
    const action = JSON.stringify(redeemPath).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="${escape(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escape(labels.shareTitle)}</title>
</head>
<body style="font-family: system-ui, sans-serif; margin: 0; padding: 48px 20px; max-width: 36rem">
<noscript><p>${escape(labels.shareNoScript)}</p></noscript>
<p id="opening" hidden>${escape(labels.shareOpening)}</p>
<form id="redeem" method="post" hidden><input type="hidden" name="key"></form>
<script>
(function () {
  var key = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  try { key = decodeURIComponent(key); } catch (e) { key = ""; }
  if (!key) { location.replace("/#${SHARE_INVALID_FRAGMENT}"); return; }
  document.getElementById("opening").hidden = false;
  var form = document.getElementById("redeem");
  form.action = ${action};
  form.elements.key.value = key;
  form.submit();
})();
</script>
</body>
</html>
`;
}

/*
 * The `/_share` page. Mount it at `app/%5Fshare/route.ts`, since Next keeps `_` folders out of routing.
 *
 * It takes the config and resolves the site per request, which no other route file of this shape
 * does, because its three lines of visitor text are the tenant's words like every other line a
 * visitor reads (barakoPress #77). A Tagalog site that set every label it was offered was still
 * showing English to the one visitor who follows a share link, which is the visitor most likely to
 * be a client being shown their own site.
 *
 * A host that belongs to no tenant is a 404, the same as every other route. A CMS that cannot be
 * reached is not: the page falls back to the words the config file carries, because a share link
 * that opens in English beats one that answers 500.
 */
export function createSharePage(base: PressConfig, options: SharePageOptions = {}) {
    const redeemPath = options.redeemPath ?? "/api/share/redeem";
    return async function GET(request: Request): Promise<Response> {
        let config: PressConfig | null = base;
        try {
            config = await resolveSite(base, request.headers);
        } catch {
            config = base;
        }
        if (!config) return new Response("Not found", { status: 404, headers: NO_STORE });
        return new Response(html(redeemPath, config.labels, config.locale), {
            headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" },
        });
    };
}
