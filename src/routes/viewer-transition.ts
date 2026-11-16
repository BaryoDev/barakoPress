import type { PressConfig } from "../config.js";
import { collectionOf } from "../collections.js";
import { ENTRY_ID, type TransitionResult } from "../delivery.js";
import { PARAM_NAME, REASON_FIELD, MAX_REASON, TRANSITION_NAME } from "../blocks/record.js";
import { resolveSite } from "../site.js";
import { sitePath } from "../site-path.js";
import { transitionAsSignedInViewer } from "../viewer.js";
import { sameOrigin } from "./share.js";

/*
 * POST: move an entry through its workflow as the signed-in viewer (barakoPress #7). It is what the
 * `transitionButton` block posts to, as a form (`application/x-www-form-urlencoded`) with `record`,
 * `transition`, `collection`, `next`, `recordParam`, `resultParam` and, for a decision that needs
 * one, `reason`, `reasonRequired` and `reasonField`.
 *
 * It calls the CMS's `PUT /api/contents/{id}/status` with `{ transition, data }` and the viewer's
 * own token, so the CMS decides whether that account may make that transition. The token is read
 * from the http-only cookie on the server and never leaves it. The answer is a 303 back to `next`
 * with `?<recordParam>=<id>&<resultParam>=<key>`, where the key is one of a fixed set the
 * `recordPanel` knows. Nothing the CMS says is put in the URL.
 *
 * Answers 404 unless the config sets `viewerSessions`. A cross-site request is refused with 403.
 *
 * `reasonRequired` is a guard for the person at the form, since the form is the caller's to change.
 * What the account may do, and which fields a transition requires, is the CMS's to enforce.
 */

const MAX_BODY_BYTES = 8192;
const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;

const refuse = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...NO_STORE, "content-type": "application/json" } });

const isForm = (request: Request) => (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");

async function readForm(request: Request): Promise<URLSearchParams | null> {
    if (!isForm(request)) return null;
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
    if (!request.body) return new URLSearchParams();
    // Read the stream up to the cap and stop, so a chunked body is never buffered whole.
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
    }
    return new URLSearchParams(new TextDecoder().decode(all));
}

export type TransitionKey = TransitionResult | "reason";

function back(next: string, recordParam: string, id: string, resultParam: string, key: TransitionKey): Response {
    const url = new URL(sitePath(next), "http://site.invalid");
    url.search = "";
    url.hash = "";
    if (ENTRY_ID.test(id)) url.searchParams.set(recordParam, id);
    url.searchParams.set(resultParam, key);
    return new Response(null, { status: 303, headers: { ...NO_STORE, location: `${url.pathname}${url.search}` } });
}

export function createViewerTransitionRoute(base: PressConfig) {
    return async function POST(request: Request): Promise<Response> {
        if (base.viewerSessions !== true) return new Response("Not found", { status: 404, headers: NO_STORE });
        const config = await resolveSite(base, request.headers);
        if (!config) return new Response("Not found", { status: 404, headers: NO_STORE });
        const hostHeader = config.sites?.hostHeader ?? "host";
        if (!sameOrigin(request, hostHeader)) return refuse(403, "cross-site");

        const form = await readForm(request);
        if (!form) return refuse(400, "bad request");
        const field = (name: string) => form.get(name) ?? "";
        const recordParam = PARAM_NAME.test(field("recordParam")) ? field("recordParam") : "record";
        const resultParam = PARAM_NAME.test(field("resultParam")) ? field("resultParam") : "result";
        const id = field("record");
        const next = field("next");
        const to = (key: TransitionKey) => back(next, recordParam, id, resultParam, key);

        const transition = field("transition").trim();
        if (!ENTRY_ID.test(id) || !TRANSITION_NAME.test(transition) || !collectionOf(config, field("collection"))) return to("invalid");

        const reason = field("reason").trim();
        if (field("reasonRequired") === "1" && reason === "") return to("reason");
        if (reason.length > MAX_REASON) return to("invalid");
        const reasonField = field("reasonField") || "reason";
        if (reason !== "" && !REASON_FIELD.test(reasonField)) return to("invalid");

        const result = await transitionAsSignedInViewer(config, id, transition, reason !== "" ? { [reasonField]: reason } : undefined);
        return to(result);
    };
}
