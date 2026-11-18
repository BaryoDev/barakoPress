import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The milestones block (#233). Nothing here reaches a network: fetch is stubbed.
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
const { milestoneLimit, repoMilestones } = await import("../github-milestones.js");

let dir: string;
const configFor = (extra: Record<string, unknown> = {}) =>
    defineConfig({ site: { name: "Test", url: "https://test.example" }, synced: { snapshotDir: dir }, ...extra });

async function html(node: ReactNode): Promise<string> {
    const stream = await renderToReadableStream(node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function render(raw: unknown, config = configFor()): Promise<string> {
    const blocks = resolveBlocks(raw, createBlockRegistry(config), { perViewer: false });
    return html(<BlockList blocks={blocks} theme={config.theme} />);
}

const block = (props: Record<string, unknown> = {}) => [{ type: "milestones", props: { repo: "BaryoDev/barakoPress", ...props } }];

const milestone = (over: Record<string, unknown> = {}) => ({
    title: "v1.0",
    due_on: "2026-12-01T07:00:00Z",
    open_issues: 1,
    closed_issues: 3,
    ...over,
});

const answer = (body: unknown) => vi.fn(async (_url: string) => new Response(JSON.stringify(body)));
const online = (body: unknown = [milestone()]) => {
    const fetch = answer(body);
    vi.stubGlobal("fetch", fetch);
    return fetch;
};
const offline = () =>
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new TypeError("fetch failed");
        }),
    );

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "press-milestones-"));
    forgetInProcessStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe("the milestones block", () => {
    it("draws title, counts, percent and a progressbar for 3 closed and 1 open as 75 percent", async () => {
        online();
        const out = await render(block({ closedLabel: "Closed", openLabel: "Open", dueLabel: "Due" }));

        expect(out).toContain("v1.0");
        expect(out).toContain('role="progressbar"');
        expect(out).toContain('aria-label="v1.0"');
        expect(out).toContain('aria-valuenow="75"');
        expect(out).toContain('aria-valuemin="0"');
        expect(out).toContain('aria-valuemax="100"');
        expect(out).toContain("width:75%");
        expect(out).toContain("3 of 4");
        expect(out).toMatch(/milestone-percent">75\s?%</);
        expect(out).toContain("Closed 3");
        expect(out).toContain("Open 1");
    });

    it("draws the due date in the site's locale, after the tenant's label", async () => {
        online();
        const en = await render(block({ dueLabel: "Due" }), configFor({ locale: "en-GB", timeZone: "UTC" }));
        const fil = await render(block({ dueLabel: "Takdang petsa" }), configFor({ locale: "fil-PH", timeZone: "UTC" }));

        expect(en).toContain("Due 1 December 2026");
        const expected = new Intl.DateTimeFormat("fil-PH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
            new Date("2026-12-01T00:00:00Z"),
        );
        expect(fil).toContain(`Takdang petsa ${expected}`);
    });

    it("says nothing the tenant did not say: no labels, no words", async () => {
        online();
        const out = await render(block());

        expect(out).not.toMatch(/Due|Closed|Open/);
        expect(out).not.toContain("milestone-closed");
        expect(out).not.toContain("milestone-open");
        expect(out).toContain("1 December 2026");
        expect(out).toContain("3 of 4");
    });

    it("shows no date, and not Invalid Date, for a milestone with no due date", async () => {
        online([milestone({ due_on: null }), milestone({ title: "v2", due_on: "not a date" })]);
        const out = await render(block({ dueLabel: "Due" }));

        expect(out).toContain("v1.0");
        expect(out).toContain("v2");
        expect(out).not.toContain("Invalid");
        expect(out).not.toContain("milestone-due");
        expect(out).not.toContain("Due");
    });

    it("draws zero issues as 0 percent with a bar, not NaN", async () => {
        online([milestone({ open_issues: 0, closed_issues: 0 })]);
        const out = await render(block());

        expect(out).toMatch(/milestone-percent">0\s?%</);
        expect(out).toContain('aria-valuenow="0"');
        expect(out).not.toContain("NaN");
    });

    it("draws 0 closed of 2 as 0 percent and all closed as 100", async () => {
        online([milestone({ title: "a", closed_issues: 0, open_issues: 2 }), milestone({ title: "b", closed_issues: 5, open_issues: 0 })]);
        const out = await render(block());

        expect(out).toContain('aria-valuenow="0"');
        expect(out).toContain('aria-valuenow="100"');
    });

    it("asks GitHub for the repo, state and limit, with no token", async () => {
        const fetch = online();
        await render(block({ state: "all", limit: 5 }));

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://api.github.com/repos/BaryoDev/barakoPress/milestones?state=all&per_page=5");
        expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
    });

    it("caps the limit and falls back to open through the helpers", async () => {
        expect(milestoneLimit(500)).toBe(30);
        expect(milestoneLimit(0)).toBe(1);
        expect(milestoneLimit(-4)).toBe(1);
        expect(milestoneLimit("abc")).toBe(30);
        expect(milestoneLimit(7.9)).toBe(7);
        const fetch = vi.fn(async (_url: string) => new Response("[]"));
        await repoMilestones(configFor(), "a/b", "open", 500, { fetch });
        expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/a/b/milestones?state=open&per_page=30");
    });

    it("drops the block for a state or limit outside the field's range, as any block does", async () => {
        const fetch = online();
        const out = await render(block({ state: "everything", limit: 500 }));
        expect(fetch).not.toHaveBeenCalled();
        expect(out).not.toContain('data-press="milestone');
    });

    it("reads again for another state on the same repo, with its own URL", async () => {
        const fetch = online();
        await render(block({ state: "open" }));
        await render(block({ state: "all" }));
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[0][0]).toContain("state=open");
        expect(fetch.mock.calls[1][0]).toContain("state=all");
    });

    it("reads once for two blocks on the same repo in one window", async () => {
        const fetch = online();
        await render([...block(), ...block()]);
        await render(block());
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each(["nope", "../etc", "a/..", "./x", "a/b/c", "a b/c", `${"x".repeat(101)}/y`, "-a/b"])(
        "refuses the repo %j without a fetch or a crash",
        async (repo) => {
            const fetch = online();
            const out = await render(block({ repo, empty: "No milestones" }));

            expect(fetch).not.toHaveBeenCalled();
            expect(out).toContain("No milestones");
            expect(out).not.toContain("undefined");
        },
    );

    it("draws nothing for a refused repo and no empty words", async () => {
        const fetch = online();
        const out = await render(block({ repo: "../x" }));
        expect(fetch).not.toHaveBeenCalled();
        expect(out).not.toContain('data-press="milestone');
    });

    it("past the window with the network off, draws the snapshot", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            online();
            await render(block());
            vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
            const fetch = vi.fn(async (_url: string) => {
                throw new TypeError("fetch failed");
            });
            vi.stubGlobal("fetch", fetch);
            forgetInProcessStore();
            const out = await render(block());

            expect(fetch).toHaveBeenCalled();
            expect(out).toContain("v1.0");
            expect(out).toContain('aria-valuenow="75"');
            expect(out).not.toContain("undefined");
        } finally {
            vi.useRealTimers();
        }
    });

    it("with the network off and no snapshot, draws nothing, or the empty words, and does not throw", async () => {
        offline();
        const bare = await render(block());
        expect(bare).not.toContain('data-press="milestone');
        expect(bare).not.toContain("undefined");

        forgetInProcessStore();
        expect(await render(block({ empty: "Nothing planned" }))).toContain("Nothing planned");
    });

    it("draws the empty words for a repo with no milestones, and nothing without them", async () => {
        online([]);
        expect(await render(block({ empty: "Nothing planned" }))).toContain("Nothing planned");
        forgetInProcessStore();
        expect(await render(block())).not.toContain('data-press="milestone');
    });

    it("drops an entry that is not a milestone and reads a bad count as zero", async () => {
        online([null, 4, { title: "" }, milestone({ title: "ok", open_issues: "x", closed_issues: -2 })]);
        const out = await render(block());

        expect(out).toContain("ok");
        expect(out).not.toContain("NaN");
        expect(out).toContain('aria-valuenow="0"');
    });

    it("past the window, a reply that is not a list is refused and the snapshot is drawn", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
            online();
            await render(block());
            vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
            const fetch = online({ message: "Not Found" });
            forgetInProcessStore();
            const out = await render(block());

            expect(fetch).toHaveBeenCalled();
            expect(out).toContain("v1.0");
        } finally {
            vi.useRealTimers();
        }
    });

    it("draws exactly one milestone when the others are junk", async () => {
        online([null, 4, { title: "" }, milestone({ title: "ok" })]);
        const out = await render(block());
        expect(out.match(/data-press="milestone"/g)).toHaveLength(1);
    });

    it("draws the due day as the UTC calendar day in a western zone", async () => {
        online([milestone({ due_on: "2026-12-01T07:00:00Z" })]);
        const out = await render(block({ dueLabel: "Due" }), configFor({ locale: "en-GB", timeZone: "Pacific/Honolulu" }));
        expect(out).toContain("Due 1 December 2026");
    });

    it("never says 100 percent while an issue is open", async () => {
        online([milestone({ closed_issues: 199, open_issues: 1 })]);
        expect(await render(block())).toMatch(/milestone-percent">99\s?%</);
    });
});

describe("repoMilestones", () => {
    it("returns null for a bad repo and never calls fetch", async () => {
        const fetch = vi.fn();
        expect(await repoMilestones(configFor(), "../x", "open", 5, { fetch })).toBeNull();
        expect(await repoMilestones(configFor(), undefined, "open", 5, { fetch })).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("keeps no more than the limit", async () => {
        const many = Array.from({ length: 10 }, (_, i) => milestone({ title: `m${i}` }));
        const got = await repoMilestones(configFor(), "a/b", "open", 3, { fetch: async () => new Response(JSON.stringify(many)) });
        expect(got?.value.map((m) => m.title)).toEqual(["m0", "m1", "m2"]);
    });
});

describe("the milestones block in /api/blocks", () => {
    it("publishes its fields", async () => {
        const res = createBlockSchemaRoute(createBlockRegistry(configFor()))();
        const body = (await res.json()) as {
            blocks: { type: string; label: string; fields: { name: string; kind: string; required?: boolean; options?: string[] }[] }[];
        };
        const found = body.blocks.find((b) => b.type === "milestones");

        expect(found?.fields.map((f) => f.name)).toEqual(["repo", "state", "limit", "dueLabel", "closedLabel", "openLabel", "empty"]);
        expect(found?.fields[0]).toMatchObject({ kind: "text", required: true });
        expect(found?.fields[1]).toMatchObject({ kind: "select", options: ["open", "closed", "all"] });
        expect(found?.fields[2]).toMatchObject({ kind: "number" });
    });
});
