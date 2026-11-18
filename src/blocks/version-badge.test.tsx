import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The version badge and the version tokens (#232). Nothing here reaches a network: fetch is stubbed.
 */
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { forgetInProcessStore } = await import("../store.js");
const { createBlockRegistry } = await import("./registry.js");
const { BlockList } = await import("./render.js");
const { resolveBlocks } = await import("./schema.js");
const { createBlockSchemaRoute } = await import("../routes/block-schema.js");

let dir: string;
const configFor = () =>
    defineConfig({
        site: { name: "Test", url: "https://test.example" },
        synced: {
            snapshotDir: dir,
            tokens: {
                "cms.Version": { source: "github", id: "BaryoDev/barakoCMS" },
                "press.Version": { source: "npm", id: "barakopress" },
                "vm.Version": { source: "nuget", id: "Baryo.VM" },
            },
        },
    });

async function html(node: ReactNode): Promise<string> {
    const stream = await renderToReadableStream(node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function render(raw: unknown): Promise<string> {
    const config = configFor();
    const blocks = resolveBlocks(raw, createBlockRegistry(config), { perViewer: false });
    return html(<BlockList blocks={blocks} theme={config.theme} />);
}

const badge = (props: Record<string, unknown> = {}) => [
    { type: "versionBadge", props: { source: "npm", id: "barakopress", label: "barakoPress", ...props } },
];

const online = () =>
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            if (url.includes("dist-tags")) return new Response(JSON.stringify({ latest: "0.18.1" }));
            if (url.includes("BaryoDev/barakoCMS")) return new Response(JSON.stringify({ tag_name: "v5.4.0" }));
            if (url.includes("flatcontainer")) return new Response(JSON.stringify({ versions: ["0.3.0", "0.4.0"] }));
            return new Response("{}", { status: 404 });
        }),
    );
const offline = () =>
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new TypeError("fetch failed");
        }),
    );

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "press-badge-"));
    forgetInProcessStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe("the versionBadge block", () => {
    it("draws the label, the version, and when it was checked", async () => {
        online();
        const out = await render(badge());

        expect(out).toContain("barakoPress");
        expect(out).toContain("0.18.1");
        expect(out).toMatch(/title="Last checked \d{4}-\d\d-\d\d \d\d:\d\d UTC"/);
        expect(out).toMatch(/, last checked \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    });

    it("with the network off and a snapshot, draws the snapshot value and its checked time", async () => {
        online();
        const first = await render(badge());
        const checked = /title="(Last checked [^"]+)"/.exec(first)![1];

        offline();
        forgetInProcessStore();
        const out = await render(badge());

        expect(out).toContain("0.18.1");
        expect(out).toContain(`title="${checked}"`);
        expect(out).not.toContain("undefined");
    });

    it("with the network off and no snapshot, draws the label alone and does not throw", async () => {
        offline();
        const out = await render(badge());

        expect(out).toContain("barakoPress");
        expect(out).not.toContain("undefined");
        expect(out).not.toContain("Last checked");
        expect(out).not.toContain("0.18");
    });

    it("draws nothing at all with the network off, no snapshot and no label", async () => {
        offline();
        const out = await render(badge({ label: undefined }));
        expect(out).not.toContain("version-badge");
        expect(out).not.toContain("undefined");
    });

    it("draws the label alone for a source it does not know, and asks nobody", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const config = configFor();
        const definition = createBlockRegistry(config).get("versionBadge")!;
        const node = await definition.component({
            props: { source: "pypi", id: "x", label: "barakoPress" },
            slots: {},
            theme: config.theme,
        });
        const out = await html(<>{node}</>);

        expect(out).toContain("barakoPress");
        expect(out).not.toContain("Last checked");
        expect(out).not.toContain("undefined");
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe("the versionBadge block in /api/blocks", () => {
    it("publishes its fields", async () => {
        const registry = createBlockRegistry(configFor());
        const res = createBlockSchemaRoute(registry)();
        const body = (await res.json()) as {
            blocks: { type: string; label: string; fields: { name: string; kind: string; required?: boolean; options?: string[] }[] }[];
        };

        const found = body.blocks.find((b) => b.type === "versionBadge");
        expect(found?.label).toBe("Version badge");
        expect(found?.fields.map((f) => f.name)).toEqual(["source", "id", "label"]);
        expect(found?.fields[0]).toMatchObject({ kind: "select", required: true, options: ["nuget", "npm", "github"] });
        expect(found?.fields[1]).toMatchObject({ kind: "text", required: true });
    });

    it("publishes its fields through the (config, registry) form the app mounts", async () => {
        const config = configFor();
        const registry = createBlockRegistry(config);
        const res = await createBlockSchemaRoute(config, registry)(new Request("https://site.example/api/blocks"));
        const body = (await res.json()) as { blocks: { type: string; fields: { name: string }[] }[] };

        expect(body.blocks.find((b) => b.type === "versionBadge")?.fields.map((f) => f.name)).toEqual(["source", "id", "label"]);
    });
});

describe("version tokens in richText", () => {
    const text = (markdown: string) => [{ type: "richText", props: { markdown } }];

    it("fills the tokens the config maps", async () => {
        online();
        const out = await render(text("CMS {cms.Version}, press {press.Version}, VM {vm.Version}."));
        expect(out).toContain("CMS v5.4.0, press 0.18.1, VM 0.4.0.");
    });

    it("maps nothing when the site lists no tokens, so the text stays as typed", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const config = defineConfig({ site: { name: "Test", url: "https://test.example" }, synced: { snapshotDir: dir } });
        const blocks = resolveBlocks(text("Now {cms.Version}."), createBlockRegistry(config), { perViewer: false });
        const out = await html(<BlockList blocks={blocks} theme={config.theme} />);
        expect(out).toContain("Now {cms.Version}.");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("leaves a name the config does not know exactly as typed", async () => {
        online();
        const out = await render(text("Value {module.Version} and {nothing}."));
        expect(out).toContain("{module.Version}");
        expect(out).toContain("{nothing}");
    });

    it("drops a token with no value rather than printing undefined", async () => {
        offline();
        const out = await render(text("Now at {cms.Version}."));
        expect(out).toContain("Now at .");
        expect(out).not.toContain("undefined");
    });

    it("uses the snapshot for a token when the network is off", async () => {
        online();
        await render(text("{press.Version}"));
        offline();
        forgetInProcessStore();
        expect(await render(text("v{press.Version}"))).toContain("v0.18.1");
    });

    it("does not reach the network for text with no token", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        await render(text("Plain {text} here."));
        expect(fetch).not.toHaveBeenCalled();
    });

    it("returns a plain value, not a promise, for text with no configured token", async () => {
        const config = configFor();
        const definition = createBlockRegistry(config).get("richText")!;
        const node = definition.component({ props: { markdown: "Plain {text} {{item.X}}." }, slots: {}, theme: config.theme });
        expect(node).not.toBeInstanceOf(Promise);
    });

    it("leaves a token alone in a fence, a code span, a link, an image, an autolink and a definition", async () => {
        online();
        const md = [
            "```",
            "{press.Version}",
            "```",
            "",
            "Use `{press.Version}` or ``a {press.Version} b``.",
            "",
            "[link](https://x.example/{press.Version}) and ![i](https://x.example/{press.Version}.png)",
            "",
            "<https://x.example/{press.Version}>",
            "",
            "[ref]: https://x.example/{press.Version}",
            "",
            "Now {press.Version}.",
        ].join("\n");
        const out = await render(text(md));

        // Only the one in prose was filled. The rest, which a URL encoder may have reshaped, were not.
        expect(out.match(/0\.18\.1/g)).toHaveLength(1);
        expect(out).toContain("Now 0.18.1.");
        expect(out).toContain("<code>{press.Version}</code>");
    });

    it("renders an escaped token as its literal text without the backslash", async () => {
        online();
        const out = await render(text("Write \\{press.Version} for it, shows {press.Version}."));
        expect(out).toContain("Write {press.Version} for it, shows 0.18.1.");
    });

    it("leaves a double-brace binding alone", async () => {
        online();
        const out = await render(text("{{press.Version}} and {press.Version}"));
        expect(out).toContain("{{press.Version}} and 0.18.1");
    });

    it("escapes markdown in a substituted value", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({ latest: "1_2*3" }))),
        );
        const out = await render(text("v{press.Version}"));
        expect(out).toContain("v1_2*3");
        expect(out).not.toContain("<em>");
    });
});

