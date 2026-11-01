import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { createBlockSchemaRoute } from "../routes/block-schema.js";
import { forgetInProcessStore, storeFor } from "../store.js";
import { createBlockRegistry } from "./registry.js";
import { readVersion, versionOf } from "./version-badge.js";

/*
 * The version badge (#232). The registries are stubbed, so these read no network.
 */

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });
const CHECKED = "2026-10-30T08:00:00.000Z";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const offline = () => vi.fn(async () => Promise.reject(new TypeError("fetch failed")));

beforeEach(() => {
    forgetInProcessStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const run = async (props: Record<string, unknown>) => {
    const block = createBlockRegistry(config).get("versionBadge")!;
    const node = await block.component({ props, slots: {}, theme: config.theme } as never);
    return renderToStaticMarkup(<>{node}</>);
};

describe("readVersion", () => {
    it("takes the newest stable NuGet version, else the newest", () => {
        expect(readVersion("nuget", { versions: ["1.0.0", "1.1.0", "2.0.0-beta.1"] })).toBe("1.1.0");
        expect(readVersion("nuget", { versions: ["1.0.0-rc.1", "1.0.0-rc.2"] })).toBe("1.0.0-rc.2");
    });
    it("reads npm and GitHub, and refuses a body with none", () => {
        expect(readVersion("npm", { version: "0.15.1" })).toBe("0.15.1");
        expect(readVersion("github", { tag_name: "v3.2.0" })).toBe("v3.2.0");
        expect(readVersion("npm", {})).toBeNull();
        expect(readVersion("nuget", { versions: [] })).toBeNull();
        expect(readVersion("github", null)).toBeNull();
    });
});

describe("versionOf", () => {
    it("reads each registry without credentials and keeps the answer", async () => {
        const fetcher = vi.fn(async (..._a: unknown[]) => json({ version: "0.15.1" }));
        vi.stubGlobal("fetch", fetcher);

        const got = await versionOf(config, "npm", "@scope/pkg");

        expect(got?.version).toBe("0.15.1");
        const [url, init] = fetcher.mock.calls[0] as [string, { headers: Record<string, string> }];
        expect(url).toBe("https://registry.npmjs.org/@scope%2Fpkg/latest");
        expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
        expect(await storeFor(config).get("stale:version:npm:@scope/pkg")).toContain("0.15.1");
    });

    it("asks GitHub for the latest release of one repo", async () => {
        const fetcher = vi.fn(async (..._a: unknown[]) => json({ tag_name: "v1.2.3" }));
        vi.stubGlobal("fetch", fetcher);

        await versionOf(config, "github", "o/p");

        expect(fetcher.mock.calls[0]![0]).toBe("https://api.github.com/repos/o/p/releases/latest");
    });

    it("does not fetch an id that is not a package name", async () => {
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);

        expect(await versionOf(config, "github", "o/p/../../x")).toBeNull();
        expect(await versionOf(config, "nuget", "a/b")).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("asks NuGet for a lowercase id", async () => {
        const fetcher = vi.fn(async (..._a: unknown[]) => json({ versions: ["1.0.0"] }));
        vi.stubGlobal("fetch", fetcher);

        await versionOf(config, "nuget", "Baryo.Press");

        expect(fetcher.mock.calls[0]![0]).toBe("https://api.nuget.org/v3-flatcontainer/baryo.press/index.json");
    });

    it("does not fetch a GitHub repo segment made of dots", async () => {
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);

        expect(await versionOf(config, "github", "o/..")).toBeNull();
        expect(await versionOf(config, "github", "../p")).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("returns a good read when the store refuses to keep it", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ version: "1.2.3" })));
        const store = { get: vi.fn(async () => null), set: vi.fn(async () => Promise.reject(new Error("down"))), delete: vi.fn(), add: vi.fn() };
        const shared = defineConfig({ site: { name: "Test", url: "https://test.example" }, store });

        expect((await versionOf(shared, "npm", "pkg"))?.version).toBe("1.2.3");
    });

    it("does not throw when the store fails while the registry is down", async () => {
        vi.stubGlobal("fetch", offline());
        const store = { get: vi.fn(async () => Promise.reject(new Error("down"))), set: vi.fn(), delete: vi.fn(), add: vi.fn() };
        const shared = defineConfig({ site: { name: "Test", url: "https://test.example" }, store });

        expect(await versionOf(shared, "npm", "pkg")).toBeNull();
    });

    it("answers from the kept value when the registry answers an error", async () => {
        await storeFor(config).set("stale:version:nuget:pkg", JSON.stringify({ version: "9.0.0", checkedAt: CHECKED }), 0);
        vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));

        expect(await versionOf(config, "nuget", "Pkg")).toEqual({ version: "9.0.0", checkedAt: CHECKED });
    });
});

describe("the versionBadge block", () => {
    it("with the network off and a kept value, renders the value and the last-checked time", async () => {
        vi.stubGlobal("fetch", offline());
        await storeFor(config).set("stale:version:npm:barakopress", JSON.stringify({ version: "0.15.1", checkedAt: CHECKED }), 0);

        const html = await run({ source: "npm", id: "barakopress", label: "Press" });

        expect(html).toContain("Press 0.15.1");
        expect(html).toContain(`title="Last checked ${CHECKED}"`);
        expect(html).toContain(`, last checked ${CHECKED}`);
    });

    it("with the network off and nothing kept, renders the label alone and does not throw", async () => {
        vi.stubGlobal("fetch", offline());

        const html = await run({ source: "npm", id: "barakopress", label: "Press" });

        expect(html).toBe("<span>Press</span>");
        expect(html).not.toContain("undefined");
    });

    it("with the network off, nothing kept and no label, renders nothing", async () => {
        vi.stubGlobal("fetch", offline());

        expect(await run({ source: "github", id: "o/p" })).toBe("");
        expect(await run({})).toBe("");
    });

    it("renders a fresh read with the label", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => json({ tag_name: "v2.0.0" })));

        const html = await run({ source: "github", id: "o/p", label: "Release" });

        expect(html).toContain("Release v2.0.0");
        expect(html).not.toContain("undefined");
    });

    it("appears in the block schema the editor reads, with its fields", async () => {
        const GET = createBlockSchemaRoute(createBlockRegistry(config));
        const schema = (await GET().json()) as {
            blocks: { type: string; fields: { name: string; required?: boolean; options?: string[] }[] }[];
        };

        const block = schema.blocks.find((b) => b.type === "versionBadge");

        expect(block?.fields.map((f) => f.name)).toEqual(["source", "id", "label"]);
        expect(block?.fields.find((f) => f.name === "source")?.options).toEqual(["nuget", "npm", "github"]);
        expect(block?.fields.filter((f) => f.required).map((f) => f.name)).toEqual(["source", "id"]);
    });
});
