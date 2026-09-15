import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag }));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { createRevalidateRoute } = await import("./revalidate.js");

const SECRET = "revalidate-secret-for-tests";
const BODY = '{"event":"Published"}';

function delivery(host: string, timestamp = String(Math.floor(Date.now() / 1000))): NextRequest {
    const signature = "sha256=" + createHmac("sha256", SECRET).update(`${timestamp}.${BODY}`).digest("hex");
    return new Request("http://internal:3000/api/revalidate", {
        method: "POST",
        headers: { host, "content-type": "application/json", "x-barako-timestamp": timestamp, "x-barako-signature": signature },
        body: BODY,
    }) as unknown as NextRequest;
}

beforeEach(() => {
    forgetCachedReads();
    revalidateTag.mockClear();
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a signed delivery to a request-time site", () => {
    it("still purges on the retry when the tenant lookup failed the first time", async () => {
        const { POST } = createRevalidateRoute(defineConfig({ sites: {}, cmsUrl: "http://cms.test" }), { secret: SECRET });
        let cmsUp = false;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                if (!cmsUp) throw new Error("ECONNREFUSED");
                return new URL(String(input)).pathname === "/api/tenants/by-host/baryo.dev"
                    ? Response.json({ handle: "baryo" })
                    : new Response("", { status: 404 });
            }),
        );
        const timestamp = String(Math.floor(Date.now() / 1000));

        await expect(POST(delivery("baryo.dev", timestamp))).rejects.toThrow("ECONNREFUSED");
        expect(revalidateTag).not.toHaveBeenCalled();

        cmsUp = true;
        vi.spyOn(console, "log").mockImplementation(() => {});
        const retry = await POST(delivery("baryo.dev", timestamp));

        expect(await retry.json()).toMatchObject({ revalidated: true, tag: "cms:baryo" });
        expect(revalidateTag).toHaveBeenCalledTimes(1);
        expect(revalidateTag).toHaveBeenCalledWith("cms:baryo", { expire: 0 });

        const replay = await POST(delivery("baryo.dev", timestamp));
        expect(await replay.json()).toEqual({ revalidated: true, repeated: true });
        expect(revalidateTag).toHaveBeenCalledTimes(1);
    });
});
