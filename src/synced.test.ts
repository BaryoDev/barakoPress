import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "./config.js";
import { forgetInProcessStore } from "./store.js";
import { syncedJson } from "./synced.js";
import { latestVersion } from "./versions.js";

/*
 * The shared cache behind the version badge (#232) and the readers of #233 and #234. No test here
 * reaches a network: every call is given a fetch.
 */
let dir: string;
const configFor = (extra: Record<string, unknown> = {}) =>
    defineConfig({ site: { name: "T", url: "https://t.example" }, synced: { snapshotDir: dir, ...extra } });

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
        expect(await syncedJson(config, { key: "a", url: "u", pick, fetch: reply({}, 503) })).toBeNull();
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

    it("does not call out for an id that is not one", async () => {
        const fetch = seen({});
        expect(await latestVersion(config(), { source: "npm", id: "x/../../y?z" }, { fetch })).toBeNull();
        expect(await latestVersion(config(), { source: "github", id: "no-slash" }, { fetch })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });
});
