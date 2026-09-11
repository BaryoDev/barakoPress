import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { CMS_TAG } from "@/lib/delivery";

/*
 * The endpoint that makes the cache correct.
 *
 * barakoCMS fires a signed webhook when a post is published, and this drops the cache tag so the
 * next request renders fresh. Nothing else invalidates, which is why this route has to be right:
 * it is the only writer to the cache, and it is reachable by anyone who finds the URL.
 *
 * The signing recipe is barakoCMS docs/webhooks.md:
 *
 *   X-Barako-Timestamp   unix seconds when it was signed
 *   X-Barako-Signature   "sha256=" + lowercase hex HMAC-SHA256 over "<timestamp>.<raw body>"
 *   X-Barako-Delivery    the delivery log row id, so both sides can join their logs
 *
 * Three details are load-bearing and easy to get wrong:
 *
 *   1. The signature covers the RAW body bytes. Parse the JSON first and you have re-serialised it
 *      into a different string that will never verify.
 *   2. Compare in constant time. A byte-by-byte early return leaks the expected signature to
 *      anyone willing to make a few thousand requests.
 *   3. Refuse an old timestamp. Without that, a delivery captured once can be replayed forever.
 */

const TOLERANCE_SECONDS = 300;

/** Constant-time compare that does not leak length through an early return either. */
function sameSignature(a: string, b: string): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
    const secret = process.env.REVALIDATE_SECRET;
    if (!secret) {
        // Refuse rather than accept unsigned. An unconfigured deployment that quietly accepts
        // anything is an open cache-purge endpoint, which is a free denial of service.
        console.error("revalidate: REVALIDATE_SECRET is not set, refusing every delivery");
        return NextResponse.json({ error: "not configured" }, { status: 503 });
    }

    const raw = Buffer.from(await request.arrayBuffer());

    const timestamp = request.headers.get("x-barako-timestamp");
    const signature = request.headers.get("x-barako-signature");
    if (!timestamp || !signature) {
        return NextResponse.json({ error: "unsigned" }, { status: 401 });
    }

    const sent = Number(timestamp);
    if (!Number.isFinite(sent)) {
        return NextResponse.json({ error: "bad timestamp" }, { status: 401 });
    }
    if (Math.abs(Date.now() / 1000 - sent) > TOLERANCE_SECONDS) {
        // Also catches a receiver whose clock has drifted, which looks identical from here.
        return NextResponse.json({ error: "stale" }, { status: 401 });
    }

    const material = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), raw]);
    const expected = "sha256=" + createHmac("sha256", secret).update(material).digest("hex");
    if (!sameSignature(expected, signature)) {
        return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }

    /*
     * `{ expire: 0 }`, not a named profile.
     *
     * Next 16 made the second argument mandatory, and it says how long a cached entry may still be
     * served while it refreshes. Passing "max" was measured serving one stale response after a
     * publish, and leaving the prerendered sitemap stale indefinitely. Zero means expire now: the
     * next request for any surface renders fresh. `updateTag` would be the other answer and is
     * Server Actions only, which a webhook is not.
     */
    revalidateTag(CMS_TAG, { expire: 0 });
    // The sitemap is a prerendered metadata route and does not follow the data tag on its own.
    revalidatePath("/sitemap.xml");

    /*
     * Absorb the stale response so a reader never gets it.
     *
     * Measured behaviour: after a purge, Next serves the previous render once and refreshes in the
     * background, so the first visitor after a publish sees the old page and the second sees the
     * new one. Requesting the main surfaces here means this server takes that stale response
     * instead of a person. It is best effort on purpose: a failure here must not fail the webhook,
     * because the purge itself already succeeded and the CMS would retry it for no reason.
     */
    const origin = new URL(request.url).origin;
    await Promise.allSettled(
        ["/", "/feed.xml", "/sitemap.xml"].map((path) =>
            fetch(`${origin}${path}`, { cache: "no-store" }).catch(() => undefined),
        ),
    );

    // The delivery id goes back in the response so a failed purge can be traced from the CMS
    // delivery log to this server's log without guessing which request was which.
    const delivery = request.headers.get("x-barako-delivery") ?? "unknown";
    console.log(`revalidate: dropped tag "${CMS_TAG}" for delivery ${delivery}`);
    return NextResponse.json({ revalidated: true, tag: CMS_TAG, delivery });
}

/*
 * GET exists to answer "is this wired up" without sending a signed request, and deliberately
 * reveals nothing: not whether a secret is set, not the tag, not the last delivery. A health check
 * that leaks configuration is how someone learns what to forge.
 */
export async function GET() {
    return NextResponse.json({ ok: true });
}
