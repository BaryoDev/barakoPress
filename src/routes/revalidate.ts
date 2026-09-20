import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import type { CollectionConfig, FieldNames, PressConfig } from "../config.js";
import { markPurged, purgeTagsFor, type ReadTarget } from "../delivery.js";
import { revalidateKeyFor } from "../revalidate-key.js";
import { MIN_SECRET_LENGTH, readSecret, type PressSecret } from "../secret.js";
import { resolveSite } from "../site.js";
import { storeFor } from "../store.js";

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
     * Defaults to PRESS_SECRET, else REVALIDATE_SECRET. A build-time site verifies with it as it is. A
     * request-time site verifies each delivery with the key `revalidateKeyFor(secret, tenant)` derives
     * for the tenant its host resolves to, so no tenant ever holds a key that verifies for another.
     * Shorter than 32 characters still verifies and warns once, as REVALIDATE_SECRET does.
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
 * a re-render of every cached page it drops. Remembering what has already been honoured turns
 * "unlimited work for five minutes" into "one". It goes through the store, so a fleet sharing one
 * honours a replayed delivery once rather than once per container (barakoPress #57). Written only
 * when the key was absent, which is why the store's `add` has to be atomic.
 */
async function alreadyHonoured(config: PressConfig, tags: string[], signature: string, windowSeconds: number): Promise<boolean> {
    // Keyed by what was purged as well as the signature, so an honoured delivery can only ever
    // stand in for the same purge. A handle has no spaces, so the key cannot be read two ways.
    const key = `replay:${tags.join(" ")} ${signature}`;
    return !(await storeFor(config).add(key, "1", windowSeconds));
}

/*
 * What this delivery says changed, as far as the site's own config can name it.
 *
 * barakoCMS sends the content type and the entry's public data with every delivery (its
 * docs/webhooks.md), and a site's config is what says which field of that type holds a slug. A type
 * this site renders nothing of, or a body that names none, leaves the target empty and the whole
 * tenant is purged, which is what every delivery did before this.
 */
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
const SLUG = /^[^\s]{1,200}$/;

function slugField(config: PressConfig, type: string): FieldNames | undefined {
    const collection = Object.values(config.collections).find((c: CollectionConfig) => c.type === type);
    if (collection) return collection.fields.slug;
    return type === config.types.page ? config.pageFields.slug : undefined;
}

function slugFrom(data: unknown, field: FieldNames | undefined): string | undefined {
    if (!data || typeof data !== "object" || field === undefined) return undefined;
    const held = data as Record<string, unknown>;
    for (const name of Array.isArray(field) ? field : [field]) {
        const value = held[name];
        if (typeof value === "string" && SLUG.test(value.trim())) return value.trim();
    }
    return undefined;
}

function changedBy(config: PressConfig, raw: Buffer): ReadTarget {
    let body: unknown;
    try {
        body = JSON.parse(raw.toString("utf8"));
    } catch {
        return {};
    }
    if (!body || typeof body !== "object") return {};
    const type = (body as { contentType?: unknown }).contentType;
    if (typeof type !== "string" || !TYPE_NAME.test(type)) return {};
    const known =
        type === config.types.page ||
        type === (config.sites?.settingsType ?? "") ||
        Object.values(config.collections).some((c: CollectionConfig) => c.type === type);
    if (!known) return {};
    return { type, slug: slugFrom((body as { data?: unknown }).data, slugField(config, type)) };
}

function configuredSecret(option: string | undefined): PressSecret | null {
    if (option === undefined) return readSecret("revalidate");
    return option ? { value: option, name: "the secret option", short: option.length < MIN_SECRET_LENGTH } : null;
}

export function createRevalidateRoute(config: PressConfig, options: RevalidateOptions = {}) {
    const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
    const maxBody = options.maxBodyBytes ?? MAX_BODY_BYTES;
    let warnedShort = false;

    async function POST(request: NextRequest) {
        const found = configuredSecret(options.secret);
        if (!found) {
            // Refuse rather than accept unsigned. An unconfigured deployment that quietly accepts
            // anything is an open cache-purge endpoint, which is a free denial of service.
            console.error("revalidate: no secret configured, refusing every delivery");
            return NextResponse.json({ error: "not configured" }, { status: 503 });
        }
        if (found.short) {
            // PRESS_SECRET is new, so it gets the rule outright. REVALIDATE_SECRET shipped in 0.3.0 with
            // no minimum, and refusing it would stop purges on a site that works today, so it warns
            // until 1.0.0. Once per route, since anyone can reach this line without a signature.
            if (found.name === "PRESS_SECRET") {
                console.error(`revalidate: PRESS_SECRET is shorter than ${MIN_SECRET_LENGTH} characters, refusing every delivery`);
                return NextResponse.json({ error: "not configured" }, { status: 503 });
            }
            if (!warnedShort) {
                warnedShort = true;
                console.warn(
                    `revalidate: ${found.name} is shorter than ${MIN_SECRET_LENGTH} characters. It still verifies until 1.0.0; set PRESS_SECRET to at least ${MIN_SECRET_LENGTH} characters instead`,
                );
            }
        }
        const secret = found.value;

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
        let site = config;
        let key = secret;
        if (config.sites) {
            // The whole config, not the handle alone: which field of a type holds a slug is the
            // tenant's `Collections` setting, and without it a delivery naming one entry can only be
            // read as "something in this tenant changed". The settings read it costs is the cached,
            // tagged one every page of this tenant makes.
            const resolved = await resolveSite(config, request.headers);
            if (!resolved?.tenant) return NextResponse.json({ error: "no site for this host" }, { status: 404 });
            site = resolved;
            key = revalidateKeyFor(secret, resolved.tenant);
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
        // Read only after the signature verified: until then the body is whatever an anonymous
        // caller sent, and what it says would decide which tags get dropped.
        const tags = purgeTagsFor(site, changedBy(site, raw));

        // After the tenant resolved, so a lookup that failed with the CMS down leaves the retry free to purge.
        if (await alreadyHonoured(site, tags, signature, tolerance)) {
            // Honest 200: the purge this delivery asked for has already happened, so the CMS has
            // no reason to retry. A 401 here would make a legitimate retry look like an attack.
            return NextResponse.json({ revalidated: true, repeated: true });
        }

        for (const tag of tags) revalidateTag(tag, { expire: 0 });
        // For the containers this delivery did not reach.
        await markPurged(storeFor(site), tags);

        // The delivery id is echoed only after the signature verified, so an anonymous caller
        // cannot put text of their choosing into this server's log.
        const delivery = request.headers.get("x-barako-delivery") ?? "unknown";
        console.log(`revalidate: dropped ${tags.map((t) => `"${t}"`).join(", ")} for delivery ${delivery}`);
        return NextResponse.json({ revalidated: true, tag: tags[0], tags, delivery });
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
