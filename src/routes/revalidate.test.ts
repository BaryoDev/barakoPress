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
const PRESS_SECRET = "one-press-secret-for-tests-0123456789abcdef";
/** What `barakopress revalidate-key baryo` printed on 1cdcdc2 with REVALIDATE_SECRET=SECRET, and what openssl prints. */
const BARYO_KEY_FROM_0_3 = "e1854345942be5d0b9ddb88d4a0df29bfe7cf80cd23d22de51304e7fd29a2eeb";
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
    // A PRESS_SECRET in the shell running these would win over every older name a test sets.
    vi.stubEnv("PRESS_SECRET", undefined);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

    it("matches the openssl one-liner the README gives, from PRESS_SECRET or the older name", async () => {
        const { execFileSync } = await import("node:child_process");
        const oneLiner = `printf 'revalidate.%s' "$1" | openssl dgst -sha256 -hmac "\${PRESS_SECRET:-$REVALIDATE_SECRET}" | sed 's/^.* //'`;
        const run = (env: Record<string, string>) => {
            const clean = { ...process.env };
            delete clean.PRESS_SECRET;
            delete clean.REVALIDATE_SECRET;
            return execFileSync("sh", ["-c", oneLiner, "sh", "baryo"], { env: { ...clean, ...env } }).toString().trim();
        };
        expect(run({ PRESS_SECRET: PRESS_SECRET })).toBe(revalidateKeyFor(PRESS_SECRET, "baryo"));
        expect(run({ REVALIDATE_SECRET: SECRET })).toBe(revalidateKeyFor(SECRET, "baryo"));
    });
});

describe("one PRESS_SECRET", () => {
    const fromEnv = () => createRevalidateRoute(defineConfig({ sites: {}, cmsUrl: "http://cms.test" }));
    const onlyEnv = (env: Record<string, string | undefined>) => {
        for (const name of ["PRESS_SECRET", "REVALIDATE_SECRET", "PRESS_PREVIEW_SECRET"]) vi.stubEnv(name, env[name]);
    };
    afterEach(() => vi.unstubAllEnvs());

    it("verifies a request-time delivery with only PRESS_SECRET set", async () => {
        onlyEnv({ PRESS_SECRET });
        cmsWithTwoTenants();
        const { POST } = fromEnv();

        const res = await POST(delivery("baryo.dev", revalidateKeyFor(PRESS_SECRET, "baryo")));
        expect(res.status).toBe(200);
        expect(revalidateTag.mock.calls).toEqual([["cms:baryo", { expire: 0 }]]);
    });

    it("verifies a build-time delivery signed with PRESS_SECRET itself", async () => {
        onlyEnv({ PRESS_SECRET });
        vi.stubGlobal("fetch", vi.fn());
        const { POST } = createRevalidateRoute(defineConfig({ site: { name: "Test", url: "https://example.com" }, cmsUrl: "http://cms.test" }));

        expect((await POST(delivery("example.com", PRESS_SECRET))).status).toBe(200);
    });

    it("still verifies a key revalidate-key printed on master, with only REVALIDATE_SECRET set", async () => {
        onlyEnv({ REVALIDATE_SECRET: SECRET });
        vi.spyOn(console, "warn").mockImplementation(() => {});
        cmsWithTwoTenants();
        const { POST } = fromEnv();

        expect(revalidateKeyFor(SECRET, "baryo")).toBe(BARYO_KEY_FROM_0_3);
        const res = await POST(delivery("baryo.dev", BARYO_KEY_FROM_0_3));
        expect(res.status).toBe(200);
        expect(revalidateTag.mock.calls).toEqual([["cms:baryo", { expire: 0 }]]);
    });

    it("takes PRESS_SECRET over REVALIDATE_SECRET when both are set", async () => {
        onlyEnv({ PRESS_SECRET, REVALIDATE_SECRET: SECRET });
        cmsWithTwoTenants();
        const { POST } = fromEnv();

        expect((await POST(delivery("baryo.dev", BARYO_KEY_FROM_0_3))).status).toBe(401);
        expect((await POST(delivery("baryo.dev", revalidateKeyFor(PRESS_SECRET, "baryo")))).status).toBe(200);
    });

    it("warns once, without the secret, when REVALIDATE_SECRET is shorter than 32 characters, and keeps verifying", async () => {
        onlyEnv({ REVALIDATE_SECRET: SECRET });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        cmsWithTwoTenants();
        const { POST } = fromEnv();

        expect(SECRET.length).toBeLessThan(32);
        expect((await POST(delivery("baryo.dev", BARYO_KEY_FROM_0_3, String(Math.floor(Date.now() / 1000))))).status).toBe(200);
        expect((await POST(delivery("baryo.dev", BARYO_KEY_FROM_0_3, String(Math.floor(Date.now() / 1000) - 1)))).status).toBe(200);

        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0].join(" ");
        expect(message).toContain("REVALIDATE_SECRET");
        expect(message).toContain("32");
        expect(message).not.toContain(SECRET);
    });

    it("does not warn about a REVALIDATE_SECRET of 32 characters or more", async () => {
        onlyEnv({ REVALIDATE_SECRET: PRESS_SECRET });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        cmsWithTwoTenants();

        expect((await fromEnv().POST(delivery("baryo.dev", revalidateKeyFor(PRESS_SECRET, "baryo")))).status).toBe(200);
        expect(warn).not.toHaveBeenCalled();
    });

    it("refuses every delivery when PRESS_SECRET is shorter than 32 characters, and logs no secret", async () => {
        onlyEnv({ PRESS_SECRET: "short-press-secret", REVALIDATE_SECRET: PRESS_SECRET });
        const logged: unknown[][] = [];
        for (const level of ["log", "warn", "error"] as const) {
            vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args));
        }
        cmsWithTwoTenants();

        const res = await fromEnv().POST(delivery("baryo.dev", revalidateKeyFor("short-press-secret", "baryo")));
        expect(res.status).toBe(503);
        expect(revalidateTag).not.toHaveBeenCalled();
        expect(logged.length).toBeGreaterThan(0);
        for (const args of logged) {
            expect(args.join(" ")).not.toContain("short-press-secret");
            expect(args.join(" ")).not.toContain(PRESS_SECRET);
        }
    });

    it("prints the key from PRESS_SECRET, falls back to REVALIDATE_SECRET, and refuses a short PRESS_SECRET", () => {
        expect(runCli(["revalidate-key", "baryo"], { PRESS_SECRET })).toEqual({ code: 0, out: revalidateKeyFor(PRESS_SECRET, "baryo") });
        expect(runCli(["revalidate-key", "baryo"], { PRESS_SECRET, REVALIDATE_SECRET: SECRET }).out).toBe(revalidateKeyFor(PRESS_SECRET, "baryo"));
        expect(runCli(["revalidate-key", "baryo"], { REVALIDATE_SECRET: SECRET }).out).toBe(BARYO_KEY_FROM_0_3);

        const short = runCli(["revalidate-key", "baryo"], { PRESS_SECRET: "short-press-secret" });
        expect(short.code).toBe(1);
        expect(short.out).toBeUndefined();
        expect(short.err).toContain("32");
        expect(short.err).not.toContain("short-press-secret");
    });
});
