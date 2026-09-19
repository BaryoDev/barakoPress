import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmsUrlFor, defineConfig, pinnedTenant } from "./config.js";
import { list } from "./delivery.js";
import { ENV_NAMES, readEnv, type PressEnv } from "./env.js";

const NAMES = Object.entries(ENV_NAMES) as [keyof PressEnv, string][];

/** Puts values in process.env for one test and takes them back out after it. */
const set = (values: Record<string, string | undefined>) => {
    const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(values)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return () => {
        for (const [k, v] of Object.entries(before)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
};

const restores: (() => void)[] = [];
const stub = (values: Record<string, string | undefined>) => restores.push(set(values));
afterEach(() => {
    restores.splice(0).forEach((undo) => undo());
    vi.unstubAllGlobals();
});

describe("readEnv", () => {
    it("reads every variable it names, under the key the code uses", () => {
        expect(NAMES.length).toBe(8);
        for (const [key, name] of NAMES) {
            stub({ [name]: `value-of-${name}` });
            expect(readEnv()[key]).toBe(`value-of-${name}`);
        }
    });

    it("leaves out a variable that is not set", () => {
        const env = readEnv(Object.fromEntries(NAMES.map(([, name]) => [name, undefined])));
        expect(NAMES.length).toBeGreaterThan(0);
        for (const [key] of NAMES) expect(env[key]).toBeUndefined();
    });

    it("hands back the value exactly as the environment has it", () => {
        // A secret with a trailing space is a different HMAC key. Trimming here would stop every
        // webhook that verifies today, silently.
        expect(readEnv({ PRESS_SECRET: " a-secret-with-space-around-it-0123456789 " }).secret).toBe(
            " a-secret-with-space-around-it-0123456789 ",
        );
    });

    it("reads an env passed to it rather than process.env", () => {
        stub({ CMS_URL: "http://from-process.test" });
        expect(readEnv({ CMS_URL: "http://passed-in.test" }).cmsUrl).toBe("http://passed-in.test");
    });
});

/*
 * The whole point of #51: one reader. A second place that names process.env puts the read time back
 * to whoever wrote that line, which is what this fixes.
 *
 * bin.ts is allowed because it hands the whole environment to runCli, which passes it to readSecret,
 * which passes it to readEnv. It names no variable of its own.
 */
describe("every environment read in src/", () => {
    const ALLOWED = new Set(["env.ts", "bin.ts"]);

    function sources(): string[] {
        const root = new URL(".", import.meta.url).pathname;
        return readdirSync(root, { recursive: true, encoding: "utf8" })
            .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
            .filter((f) => !ALLOWED.has(f));
    }

    it("goes through readEnv", () => {
        const root = new URL(".", import.meta.url).pathname;
        const files = sources();
        expect(files.length).toBeGreaterThan(20);
        const reading = files.filter((f) => readFileSync(join(root, f), "utf8").includes("process" + ".env"));
        expect(reading).toEqual([]);
    });
});

describe("cmsUrlFor", () => {
    it("takes what the config named", () => {
        stub({ CMS_URL: "http://from-env.test" });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" }, cmsUrl: "http://named.test" });
        expect(cmsUrlFor(config)).toBe("http://named.test");
    });

    it("takes CMS_URL when the config named none, without its trailing slash", () => {
        stub({ CMS_URL: "http://from-env.test/" });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        expect(cmsUrlFor(config)).toBe("http://from-env.test");
    });

    it("falls back to localhost when neither names one", () => {
        stub({ CMS_URL: undefined });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        expect(cmsUrlFor(config)).toBe("http://localhost:5005");
    });

    it("reads CMS_URL on the call, not when defineConfig ran", () => {
        stub({ CMS_URL: undefined });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        expect(cmsUrlFor(config)).toBe("http://localhost:5005");
        stub({ CMS_URL: "http://set-later.test" });
        expect(cmsUrlFor(config)).toBe("http://set-later.test");
    });
});

describe("pinnedTenant", () => {
    it("takes what the config named", () => {
        stub({ CMS_TENANT: "from-env" });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" }, tenant: "named" });
        expect(pinnedTenant(config)).toBe("named");
    });

    it("takes CMS_TENANT when the config named none", () => {
        stub({ CMS_TENANT: "from-env" });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        expect(pinnedTenant(config)).toBe("from-env");
    });

    it("is undefined when neither names one", () => {
        stub({ CMS_TENANT: undefined });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        expect(pinnedTenant(config)).toBeUndefined();
    });

    it("reads CMS_TENANT on the call, not when defineConfig ran", () => {
        stub({ CMS_TENANT: undefined });
        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        expect(pinnedTenant(config)).toBeUndefined();
        stub({ CMS_TENANT: "set-later" });
        expect(pinnedTenant(config)).toBe("set-later");
    });
});

/*
 * The compatibility this change had to keep.
 *
 * A build-time site reads with the config `defineConfig` returned and nothing else: generateStaticParams
 * calls listCollection with it directly, never through resolveSite. Before #51 those reads used the
 * CMS_URL and CMS_TENANT that defineConfig baked in. They still do, read a moment later.
 */
describe("a build-time site with CMS_URL and CMS_TENANT in the environment", () => {
    const empty = { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNextPage: false };

    it("reads from CMS_URL and sends CMS_TENANT as X-Tenant, from the unresolved config", async () => {
        stub({ CMS_URL: "http://cms-from-env.test", CMS_TENANT: "baryo" });
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(empty), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        await list(config, "post");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("http://cms-from-env.test/api/public/post?page=1&pageSize=20");
        expect(init.headers).toEqual({ "X-Tenant": "baryo" });
    });

    it("sends no X-Tenant when CMS_TENANT is unset, as before", async () => {
        stub({ CMS_URL: "http://cms-from-env.test", CMS_TENANT: undefined });
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(empty), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
        await list(config, "post");

        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(init.headers).toEqual({});
    });
});
