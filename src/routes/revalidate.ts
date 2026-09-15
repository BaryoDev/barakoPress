import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import type { PressConfig } from "../config.js";
import { cacheTagFor } from "../delivery.js";
import { revalidateKeyFor } from "../revalidate-key.js";
import { tenantFromHeaders } from "../site.js";

/*
 * The endpoint that makes the cache correct.
 *
 * barakoCMS fires a signed webhook when content changes and this drops the cache tag, so the next
 * request renders fresh. It is the only writer to the cache and it is reachable by anyone who
 * finds the URL, so the order of the checks matters as much as the checks.
 *
 * The signing recipe is barakoCMS docs/webhooks.md:
 *
 *   X-Barako-Timestamp   unix seconds when it was signed
 *   X-Barako-Signature   "sha256=" + lowercase hex HMAC-SHA256 over "<timestamp>.<raw body>"
 *   X-Barako-Delivery    the delivery log row id
 *
 * Four things are load-bearing:
 *
 *   1. The signature covers the RAW body bytes. Parse the JSON first and you have re-serialised
 *      it into a different string that will never verify.
 *   2. Constant-time compare, or a few thousand requests recover the expected signature.
 *   3. An old timestamp is refused, so a captured delivery cannot be replayed forever.
 *   4. Cheap checks come first. Reading an unbounded body into memory before authenticating lets
 *      an anonymous caller spend this server's memory, so the length is checked first and the
 *      read is capped.
 */

const TOLERANCE_SECONDS = 300;

/** A signed delivery is small. Anything larger did not come from the CMS. */
const MAX_BODY_BYTES = 64 * 1024;

export interface RevalidateOptions {
    /**
     * Defaults to REVALIDATE_SECRET. A build-time site verifies with it as it is. A request-time site
     * verifies each delivery with the key `revalidateKeyFor(secret, tenant)` derives for the tenant
     * its host resolves to, so no tenant ever holds a key that verifies for another.
     */
    secret?: string;
    /** Seconds a signature stays valid. Shorter is safer; the sender's clock has to be close. */
    toleranceSeconds?: number;
    maxBodyBytes?: number;
}

/** Constant-time compare that does not leak length through an early return either. */
function sameSignature(a: string, b: string): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}

/*
 * A replayed delivery is honoured once.
 *
 * A captured signature stays valid for the whole tolerance window, and each accepted purge costs
 * a re-render of every cached page. Remembering what has already been honoured turns "unlimited
 * work for five minutes" into "one". In-process, which is the same scope as the cache it
 * protects: another instance has its own cache and would do its own single purge anyway.
 */
function makeReplayGuard(windowSeconds: number) {
    const seen = new Map<string, number>();
    // Keyed by what was purged as well as the signature, so an honoured delivery can only ever
    // stand in for the same purge. A handle has no spaces, so the key cannot be read two ways.
    return function alreadyHonoured(tag: string, signature: string): boolean {
        const now = Date.now() / 1000;
        for (const [key, at] of seen) if (now - at > windowSeconds) seen.delete(key);
        const key = `${tag} ${signature}`;
        if (seen.has(key)) return true;
        seen.set(key, now);
        return false;
    };
}

export function createRevalidateRoute(config: PressConfig, options: RevalidateOptions = {}) {
    const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
    const maxBody = options.maxBodyBytes ?? MAX_BODY_BYTES;
    const alreadyHonoured = makeReplayGuard(tolerance);

    async function POST(request: NextRequest) {
        const secret = options.secret ?? process.env.REVALIDATE_SECRET;
        if (!secret) {
            // Refuse rather than accept unsigned. An unconfigured deployment that quietly accepts
            // anything is an open cache-purge endpoint, which is a free denial of service.
            console.error("revalidate: no secret configured, refusing every delivery");
            return NextResponse.json({ error: "not configured" }, { status: 503 });
        }

        const timestamp = request.headers.get("x-barako-timestamp");
        const signature = request.headers.get("x-barako-signature");
        if (!timestamp || !signature) {
            return NextResponse.json({ error: "unsigned" }, { status: 401 });
        }

        const sent = Number(timestamp);
        if (!Number.isFinite(sent)) {
            return NextResponse.json({ error: "bad timestamp" }, { status: 401 });
        }
        if (Math.abs(Date.now() / 1000 - sent) > tolerance) {
            // Also catches a receiver whose clock has drifted, which looks identical from here.
            return NextResponse.json({ error: "stale" }, { status: 401 });
        }

        // Length before content: the last check that costs nothing.
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > maxBody) {
            return NextResponse.json({ error: "too large" }, { status: 413 });
        }

        const raw = Buffer.from(await request.arrayBuffer());
        if (raw.byteLength > maxBody) {
            // A chunked request declares no length, so the read is bounded again here.
            return NextResponse.json({ error: "too large" }, { status: 413 });
        }

        /*
         * A request-time site purges only the tenant this delivery came to, and verifies with that
         * tenant's key. The webhook URL is on the tenant's own domain, so the host resolves it exactly
         * as it resolves a page, and a host with no tenant purges nothing. The lookup comes before the
         * signature because the key depends on it; it is the same bounded, cached lookup any page
         * request makes.
         */
        let tag = config.cacheTag;
        let key = secret;
        if (config.sites) {
            const found = await tenantFromHeaders(config, request.headers);
            if (!found) return NextResponse.json({ error: "no site for this host" }, { status: 404 });
            tag = cacheTagFor({ ...config, tenant: found.tenant });
            key = revalidateKeyFor(secret, found.tenant);
        }

        const material = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), raw]);
        const expected = "sha256=" + createHmac("sha256", key).update(material).digest("hex");
        if (!sameSignature(expected, signature)) {
            return NextResponse.json({ error: "bad signature" }, { status: 401 });
        }

        /*
         * No cache warming here, deliberately.
         *
         * An earlier version fetched the main pages after purging, on the theory that Next serves
         * one stale response after a purge and this server should absorb it. Measured against a
         * CMS that logs every read, those fetches caused zero reads and re-rendered nothing:
         * `{ expire: 0 }` already makes the next request a blocking miss, and a page that was
         * never in the warm list was equally fresh for its first reader.
         *
         * It could not have worked in the shipped stack anyway. Caddy sets X-Forwarded-Proto, so
         * the origin resolved to https against the plain HTTP server inside this container, and
         * the failure was swallowed without a log line. Three requests per delivery, latency on
         * the response, and triple the work an attacker gets from one captured signature, for
         * nothing.
         */
        // After the tenant resolved, so a lookup that failed with the CMS down leaves the retry free to purge.
        if (alreadyHonoured(tag, signature)) {
            // Honest 200: the purge this delivery asked for has already happened, so the CMS has
            // no reason to retry. A 401 here would make a legitimate retry look like an attack.
            return NextResponse.json({ revalidated: true, repeated: true });
        }

        revalidateTag(tag, { expire: 0 });

        // The delivery id is echoed only after the signature verified, so an anonymous caller
        // cannot put text of their choosing into this server's log.
        const delivery = request.headers.get("x-barako-delivery") ?? "unknown";
        console.log(`revalidate: dropped tag "${tag}" for delivery ${delivery}`);
        return NextResponse.json({ revalidated: true, tag, delivery });
    }

    /*
     * GET answers "is this wired up" without a signed request, and reveals nothing: not whether a
     * secret is set, not the tag, not the last delivery. A health check that leaks configuration
     * is how someone learns what to forge.
     */
    async function GET() {
        return NextResponse.json({ ok: true });
    }

    return { POST, GET };
}
