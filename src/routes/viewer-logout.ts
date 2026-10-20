import type { PressConfig } from "../config.js";
import { signOut } from "../viewer.js";
import { sameOrigin } from "./share.js";

/*
 * POST: end the viewer's session by clearing the cookie (barakoPress #7). Answers 404 unless the
 * config sets `viewerSessions`.
 */

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;

export function createViewerLogoutRoute(base: PressConfig) {
    return async function POST(request: Request): Promise<Response> {
        if (base.viewerSessions !== true) return new Response("Not found", { status: 404, headers: NO_STORE });
        const hostHeader = base.sites?.hostHeader ?? "host";
        if (!sameOrigin(request, hostHeader)) {
            return new Response(JSON.stringify({ error: "cross-site" }), { status: 403, headers: { ...NO_STORE, "content-type": "application/json" } });
        }
        await signOut();
        return new Response(JSON.stringify({ signedOut: true }), { status: 200, headers: { ...NO_STORE, "content-type": "application/json" } });
    };
}
