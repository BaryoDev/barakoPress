import type { PressConfig } from "../config.js";
import { resolveSite } from "../site.js";
import { signIn } from "../viewer.js";
import { sameOrigin } from "./share.js";

/*
 * POST: sign a viewer in (barakoPress #7). Body is JSON `{ "username", "password" }`. The token goes
 * into an http-only cookie and is not in the response. Answers 404 unless the config sets
 * `viewerSessions`, so a site that does not opt in has no such route.
 */

const MAX_BODY_BYTES = 4096;
const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;

const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, "content-type": "application/json" } });

async function readCredentials(request: Request): Promise<{ username: string; password: string } | null> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return null;
    try {
        const body = JSON.parse(raw) as { username?: unknown; password?: unknown };
        if (typeof body?.username !== "string" || typeof body.password !== "string") return null;
        if (body.username === "" || body.password === "") return null;
        return { username: body.username, password: body.password };
    } catch {
        return null;
    }
}

export function createViewerLoginRoute(base: PressConfig) {
    return async function POST(request: Request): Promise<Response> {
        if (base.viewerSessions !== true) return new Response("Not found", { status: 404, headers: NO_STORE });
        const config = await resolveSite(base, request.headers);
        if (!config) return new Response("Not found", { status: 404, headers: NO_STORE });
        const hostHeader = config.sites?.hostHeader ?? "host";
        if (!sameOrigin(request, hostHeader)) return reply(403, { error: "cross-site" });
        const credentials = await readCredentials(request);
        if (!credentials) return reply(400, { error: "bad request" });
        const result = await signIn(config, credentials);
        if (result.ok) return reply(200, { signedIn: true });
        if (result.reason === "invalid") return reply(401, { error: "invalid" });
        if (result.reason === "approval") return reply(403, { error: "approval" });
        return reply(502, { error: "unavailable" });
    };
}
