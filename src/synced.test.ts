import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "./config.js";
import { forgetInProcessStore, memoryStore, type PressStore } from "./store.js";
import { syncedJson } from "./synced.js";
import { latestVersion } from "./versions.js";

/*
 * The shared cache behind the version badge (#232) and the readers of #233 and #234. No test here
 * reaches a network: every call is given a fetch.
 */
let dir: string;
const configFor = ({ store, ...synced }: Record<string, unknown> = {}) =>
    defineConfig({
        site: { name: "T", url: "https://t.example" },
        synced: { snapshotDir: dir, ...synced },
        ...(store ? { store: store as PressStore } : {}),
    });

const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
let down: ReturnType<typeof makeDown>;
const makeDown = () =>
    vi.fn(async () => {
        throw new TypeError("fetch failed");
    });
const pick = (json: unknown) => (json as { v?: string }).v;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "press-synced-"));
    forgetInProcessStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    down = makeDown();
});
afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe("syncedJson", () => {
    it("asks the source once per window and answers from the kept value after", async () => {
        const fetch = vi.fn(reply({ v: "1.0.0" }));
        const config = configFor({ revalidateSeconds: 60 });
        let t = 1_000_000;
        const opts = { key: "npm:x", url: "https://registry.example/x", pick, fetch, now: () => t };

        const first = await syncedJson(config, opts);
        t += 59_000;
        const second = await syncedJson(config, opts);
        t += 2_000;
        const third = await syncedJson(config, opts);

        expect(first).toEqual({ value: "1.0.0", checkedAt: 1_000_000, stale: false });
        expect(second?.checkedAt).toBe(1_000_000);
        expect(third?.checkedAt).toBe(1_061_000);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("serves the snapshot file when the source is down and nothing is held in process", async () => {
        const config = configFor();
        await syncedJson(config, { key: "npm:x", url: "https://registry.example/x", pick, fetch: reply({ v: "2.0.0" }), now: () => 5_000 });
        forgetInProcessStore();

        const got = await syncedJson(config, { key: "npm:x", url: "https://registry.example/x", pick, fetch: down, now: () => 9_000_000 });

        expect(got).toEqual({ value: "2.0.0", checkedAt: 5_000, stale: true });
    });

    it("answers null, and does not throw, when the source is down and there is no snapshot", async () => {
        const got = await syncedJson(configFor(), { key: "npm:none", url: "https://registry.example/x", pick, fetch: down });
        expect(got).toBeNull();
    });

    it("treats a bad status and a reply it cannot read as a failure", async () => {
        const config = configFor();
        // A body that would pick fine, so only the status check can refuse it.
        expect(await syncedJson(config, { key: "a", url: "u", pick, fetch: reply({ v: "9" }, 503) })).toBeNull();
        forgetInProcessStore();
        expect(await syncedJson(config, { key: "a", url: "u", pick, fetch: reply({ other: 1 }) })).toBeNull();
    });

    it("does not retry a failed source on every render", async () => {
        const config = configFor();
        const opts = { key: "npm:y", url: "https://registry.example/y", pick, fetch: down };
        await syncedJson(config, opts);
        await syncedJson(config, opts);
        expect(down).toHaveBeenCalledTimes(1);
    });

    it("ignores a snapshot it cannot write", async () => {
        const blocked = join(dir, "file");
        await writeFile(blocked, "not a directory");
        const config = configFor({ snapshotDir: join(blocked, "inside") });

        const got = await syncedJson(config, { key: "k", url: "u", pick, fetch: reply({ v: "3.0.0" }) });

        expect(got?.value).toBe("3.0.0");
        expect(await readdir(dir)).toEqual(["file"]);
    });

    it("ignores a snapshot file that is not valid", async () => {
        const config = configFor();
        await syncedJson(config, { key: "bad", url: "u", pick, fetch: reply({ v: "1" }) });
        const [file] = await readdir(dir);
        await writeFile(join(dir, file!), "{not json");
        forgetInProcessStore();

        expect(await syncedJson(config, { key: "bad", url: "u", pick, fetch: down })).toBeNull();
    });
});


describe("syncedJson, the rest", () => {
    const url = "https://registry.example/x";

    it("passes a timeout signal and skips the Next data cache", async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ v: "1" })));
        await syncedJson(configFor({ timeoutMs: 1234 }), { key: "t", url, pick, fetch });
        const init = fetch.mock.calls[0]![1]!;
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.cache).toBe("no-store");
        expect(init).not.toHaveProperty("next");
    });

    it("holds off longer after a 403 that says how long, within the window", async () => {
        const sets: [string, number][] = [];
        const base = memoryStore();
        const store: PressStore = { ...base, set: async (k, v, ttl) => (sets.push([k, ttl]), base.set(k, v, ttl)) };
        const limited = (headers: Record<string, string>) => async () => new Response("{}", { status: 403, headers });
        const config = configFor({ revalidateSeconds: 3600, store });
        const run = (key: string, headers: Record<string, string>) =>
            syncedJson(config, { key, url, pick, fetch: limited(headers), now: () => 1_000_000 });

        await run("a", { "retry-after": "600" });
        await run("b", { "x-ratelimit-reset": String(1_000 + 900) });
        await run("c", { "retry-after": "5" });
        await run("d", { "retry-after": "999999" });

        const marker = (k: string) => sets.find(([key]) => key === `synced-failed:${k}`)![1];
        expect(marker("a")).toBe(600);
        expect(marker("b")).toBe(900);
        expect(marker("c")).toBe(60);
        expect(marker("d")).toBe(3600);
    });

    it("does not overwrite a good snapshot with a bad reply", async () => {
        const config = configFor();
        await syncedJson(config, { key: "keep", url, pick, fetch: reply({ v: "1" }), now: () => 1_000 });
        const [file] = await readdir(dir);
        const before = await readFile(join(dir, file!), "utf8");
        forgetInProcessStore();

        const got = await syncedJson(config, { key: "keep", url, pick, fetch: reply({ nope: 1 }), now: () => 90_000_000 });

        expect(got).toEqual({ value: "1", checkedAt: 1_000, stale: true });
        expect(await readFile(join(dir, file!), "utf8")).toBe(before);
    });

    it("names the snapshot file from the lowercased key with every odd character escaped", async () => {
        await syncedJson(configFor(), { key: "npm:@Scope/Pkg", url, pick, fetch: reply({ v: "1" }) });
        expect(await readdir(dir)).toEqual(["npm~3a~40scope~2fpkg.json"]);
    });

    it("makes one call for callers that arrive together", async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ v: "1" })));
        const config = configFor();
        const all = await Promise.all([1, 2, 3].map(() => syncedJson(config, { key: "herd", url, pick, fetch })));
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(all.map((g) => g?.value)).toEqual(["1", "1", "1"]);
    });

    it("uses a fresh snapshot on a cold store without asking the source", async () => {
        const config = configFor();
        await syncedJson(config, { key: "cold", url, pick, fetch: reply({ v: "7" }), now: () => 10_000 });
        forgetInProcessStore();
        const fetch = vi.fn();

        const got = await syncedJson(config, { key: "cold", url, pick, fetch, now: () => 20_000 });

        expect(got).toEqual({ value: "7", checkedAt: 10_000, stale: false });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("treats a store that throws as a miss and does not throw", async () => {
        const broken: PressStore = {
            get: async () => {
                throw new Error("redis down");
            },
            set: async () => {
                throw new Error("redis down");
            },
            delete: async () => {},
            add: async () => false,
        };
        const got = await syncedJson(configFor({ store: broken }), { key: "broken", url, pick, fetch: reply({ v: "5" }) });
        expect(got?.value).toBe("5");
    });
});

describe("latestVersion", () => {
    const config = () => configFor();
    const seen = (body: unknown) => {
        const fetch = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify(body)));
        return fetch;
    };

    it("reads the latest release tag from GitHub", async () => {
        const fetch = seen({ tag_name: "v1.4.0" });
        const got = await latestVersion(config(), { source: "github", id: "BaryoDev/barakoPress" }, { fetch });
        expect(got?.value).toBe("v1.4.0");
        expect(fetch.mock.calls[0]![0]).toBe("https://api.github.com/repos/BaryoDev/barakoPress/releases/latest");
    });

    it("reads the latest dist-tag from npm, scoped names included", async () => {
        const fetch = seen({ latest: "0.18.1", next: "0.19.0-rc.1" });
        const got = await latestVersion(config(), { source: "npm", id: "@baryo/press" }, { fetch });
        expect(got?.value).toBe("0.18.1");
        expect(fetch.mock.calls[0]![0]).toBe("https://registry.npmjs.org/-/package/@baryo%2Fpress/dist-tags");
    });

    it("takes the newest stable version from NuGet", async () => {
        const fetch = seen({ versions: ["1.0.0", "2.0.0", "2.1.0-beta.1"] });
        const got = await latestVersion(config(), { source: "nuget", id: "BarakoCMS.Client" }, { fetch });
        expect(got?.value).toBe("2.0.0");
        expect(fetch.mock.calls[0]![0]).toBe("https://api.nuget.org/v3-flatcontainer/barakocms.client/index.json");
    });

    it("returns null for a github reply with no tag and an npm reply with no latest", async () => {
        expect(await latestVersion(config(), { source: "github", id: "a/b" }, { fetch: seen({ name: "x" }) })).toBeNull();
        expect(await latestVersion(config(), { source: "npm", id: "pkg" }, { fetch: seen({ next: "1" }) })).toBeNull();
    });

    it("allows uppercase in an npm id and keys the read from the lowercased id", async () => {
        const fetch = seen({ latest: "1.0.0" });
        await latestVersion(config(), { source: "npm", id: "Legacy-Pkg" }, { fetch });
        await latestVersion(config(), { source: "npm", id: "legacy-pkg" }, { fetch });
        expect(fetch.mock.calls[0]![0]).toBe("https://registry.npmjs.org/-/package/Legacy-Pkg/dist-tags");
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("refuses ids with dot segments, a bad first character, or too long", async () => {
        const fetch = seen({});
        const bad = [
            { source: "github", id: "a/.." },
            { source: "github", id: "../b" },
            { source: "github", id: "a/..." },
            { source: "nuget", id: ".." },
            { source: "nuget", id: "." },
            { source: "nuget", id: ".hidden" },
            { source: "nuget", id: "a".repeat(101) },
            { source: "npm", id: "a".repeat(215) },
            { source: "github", id: `${"a".repeat(101)}/b` },
            { source: "github", id: `a/${"b".repeat(101)}` },
        ] as const;
        for (const ref of bad) expect(await latestVersion(config(), ref, { fetch })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("does not call out for an id that is not one", async () => {
        const fetch = seen({});
        expect(await latestVersion(config(), { source: "npm", id: "x/../../y?z" }, { fetch })).toBeNull();
        expect(await latestVersion(config(), { source: "github", id: "no-slash" }, { fetch })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
