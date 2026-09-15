import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag }));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { createRevalidateRoute } = await import("./revalidate.js");
const { revalidateKeyFor, runCli } = await import("../revalidate-key.js");

const SECRET = "revalidate-secret-for-tests";
const BODY = '{"event":"Published"}';
const HOSTS: Record<string, string> = { "baryo.dev": "baryo", "rckoronadal.org": "rckoronadal" };

function delivery(host: string, key: string, timestamp = String(Math.floor(Date.now() / 1000))): NextRequest {
    const signature = "sha256=" + createHmac("sha256", key).update(`${timestamp}.${BODY}`).digest("hex");
    return new Request("http://internal:3000/api/revalidate", {
        method: "POST",
        headers: { host, "content-type": "application/json", "x-barako-timestamp": timestamp, "x-barako-signature": signature },
        body: BODY,
    }) as unknown as NextRequest;
}

function cmsWithTwoTenants() {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
            const match = new URL(String(input)).pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
            const handle = match ? HOSTS[decodeURIComponent(match[1])] : undefined;
            return handle ? Response.json({ handle }) : new Response("", { status: 404 });
        }),
    );
}

const requestTime = () => createRevalidateRoute(defineConfig({ sites: {}, cmsUrl: "http://cms.test" }), { secret: SECRET });

beforeEach(() => {
    forgetCachedReads();
    revalidateTag.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a signed delivery to a request-time site", () => {
    it("still purges on the retry when the tenant lookup failed the first time", async () => {
        const { POST } = requestTime();
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
        const key = revalidateKeyFor(SECRET, "baryo");
        const timestamp = String(Math.floor(Date.now() / 1000));

        await expect(POST(delivery("baryo.dev", key, timestamp))).rejects.toThrow("ECONNREFUSED");
        expect(revalidateTag).not.toHaveBeenCalled();

        cmsUp = true;
        const retry = await POST(delivery("baryo.dev", key, timestamp));

        expect(await retry.json()).toMatchObject({ revalidated: true, tag: "cms:baryo" });
        expect(revalidateTag).toHaveBeenCalledTimes(1);
        expect(revalidateTag).toHaveBeenCalledWith("cms:baryo", { expire: 0 });

        const replay = await POST(delivery("baryo.dev", key, timestamp));
        expect(await replay.json()).toEqual({ revalidated: true, repeated: true });
        expect(revalidateTag).toHaveBeenCalledTimes(1);
    });

    it("verifies with the key of the tenant its host resolves to, so one tenant cannot purge another", async () => {
        const { POST } = requestTime();
        cmsWithTwoTenants();
        const baryoKey = revalidateKeyFor(SECRET, "baryo");

        const own = await POST(delivery("baryo.dev", baryoKey));
        expect(own.status).toBe(200);
        expect(await own.json()).toMatchObject({ revalidated: true, tag: "cms:baryo" });

        const elsewhere = await POST(delivery("rckoronadal.org", baryoKey));
        expect(elsewhere.status).toBe(401);

        // What every tenant's workflow used to hold. It verifies for no tenant now.
        const shared = await POST(delivery("rckoronadal.org", SECRET));
        expect(shared.status).toBe(401);

        expect(revalidateTag.mock.calls).toEqual([["cms:baryo", { expire: 0 }]]);
    });

    it("does not let a delivery replayed to another host first suppress the real purge", async () => {
        const { POST } = requestTime();
        cmsWithTwoTenants();
        const key = revalidateKeyFor(SECRET, "baryo");
        const timestamp = String(Math.floor(Date.now() / 1000));

        const replayed = await POST(delivery("rckoronadal.org", key, timestamp));
        expect(replayed.status).toBe(401);

        const real = await POST(delivery("baryo.dev", key, timestamp));
        expect(await real.json()).toMatchObject({ revalidated: true, tag: "cms:baryo" });
        expect(revalidateTag.mock.calls).toEqual([["cms:baryo", { expire: 0 }]]);
    });
});

describe("a signed delivery to a build-time site", () => {
    it("verifies with REVALIDATE_SECRET itself, as before, and reads no tenant", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubEnv("REVALIDATE_SECRET", SECRET);
        try {
            const { POST } = createRevalidateRoute(defineConfig({ site: { name: "Test", url: "https://example.com" }, cmsUrl: "http://cms.test" }));

            const signed = await POST(delivery("example.com", SECRET));
            expect(signed.status).toBe(200);
            expect(await signed.json()).toMatchObject({ revalidated: true, tag: "cms" });

            const derived = await POST(delivery("example.com", revalidateKeyFor(SECRET, "example")));
            expect(derived.status).toBe(401);

            expect(revalidateTag.mock.calls).toEqual([["cms", { expire: 0 }]]);
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe("barakopress revalidate-key", () => {
    it("prints the tenant's key, and not the secret", () => {
        const result = runCli(["revalidate-key", "baryo"], { REVALIDATE_SECRET: SECRET });
        expect(result).toEqual({ code: 0, out: revalidateKeyFor(SECRET, "baryo") });
        expect(result.out).toMatch(/^[0-9a-f]{64}$/);
        expect(result.out).not.toContain(SECRET);
        expect(revalidateKeyFor(SECRET, "baryo")).not.toBe(revalidateKeyFor(SECRET, "rckoronadal"));
    });

    it("refuses with no secret, a handle that is not one, or the wrong command, and names no secret", () => {
        for (const [args, env] of [
            [["revalidate-key", "baryo"], {}],
            [["revalidate-key", "not a handle"], { REVALIDATE_SECRET: SECRET }],
            [["revalidate-key"], { REVALIDATE_SECRET: SECRET }],
            [["something-else", "baryo"], { REVALIDATE_SECRET: SECRET }],
        ] as const) {
            const result = runCli([...args], env);
            expect(result.code).not.toBe(0);
            expect(result.out).toBeUndefined();
            expect(result.err).not.toContain(SECRET);
        }
    });

    it("matches the openssl one-liner the README gives", async () => {
        const { execFileSync } = await import("node:child_process");
        const viaOpenssl = execFileSync("sh", ["-c", `printf 'revalidate.%s' "$1" | openssl dgst -sha256 -hmac "$REVALIDATE_SECRET" | sed 's/^.* //'`, "sh", "baryo"], {
            env: { ...process.env, REVALIDATE_SECRET: SECRET },
        })
            .toString()
            .trim();
        expect(viaOpenssl).toBe(revalidateKeyFor(SECRET, "baryo"));
    });
});
