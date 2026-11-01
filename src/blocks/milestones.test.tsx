import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { forgetInProcessStore } from "../store.js";
import { createBlockRegistry } from "./registry.js";
import { MilestonesView, milestonesOf, percentClosed } from "./milestones.js";

/*
 * The milestones block (#233): a repository's milestones on the progress bar. The API is stubbed,
 * so these read no network.
 */

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });

const milestone = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: `v${number}.0`,
    open_issues: 1,
    closed_issues: 3,
    due_on: "2026-12-31T00:00:00Z",
    ...extra,
});

function answer(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
    forgetInProcessStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("milestonesOf", () => {
    it("reads title, counts and due date from the public API with no credentials", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([milestone(1)]));
        vi.stubGlobal("fetch", fetcher);

        const rows = await milestonesOf(config, "o/p", "all", 10);

        expect(rows).toEqual([{ title: "v1.0", number: 1, open: 1, closed: 3, dueOn: "2026-12-31" }]);
        const [url, init] = fetcher.mock.calls[0] as [string, { headers: Record<string, string> }];
        expect(url).toContain("https://api.github.com/repos/o/p/milestones?state=all");
        expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    });

    it("keeps no due date as null, whatever the API sent", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1, { due_on: null }), milestone(2, { due_on: "soon" })])));

        const rows = await milestonesOf(config, "o/p", "open", 10);

        expect(rows.map((r) => r.dueOn)).toEqual([null, null]);
    });

    it("stops at the limit", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1), milestone(2), milestone(3)])));

        expect((await milestonesOf(config, "o/p", "open", 2)).map((r) => r.number)).toEqual([1, 2]);
    });

    it("serves the last good answer when a later read fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1)])));
        await milestonesOf(config, "o/p", "open", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({ message: "down" }, 503)));
        const rows = await milestonesOf(config, "o/p", "open", 10);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ title: "v1.0", open: 1, closed: 3 });
    });

    it("serves the last good answer when the network throws", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1)])));
        await milestonesOf(config, "o/p", "open", 10);

        vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

        expect(await milestonesOf(config, "o/p", "open", 10)).toHaveLength(1);
    });

    it("lists nothing, and does not throw, when a read fails and nothing was kept", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 500)));

        await expect(milestonesOf(config, "o/p", "open", 10)).resolves.toEqual([]);
    });

    it("reads nothing for a value that is not owner/name", async () => {
        const fetcher = vi.fn(async () => answer([]));
        vi.stubGlobal("fetch", fetcher);

        expect(await milestonesOf(config, "../x", "open", 10)).toEqual([]);
        expect(await milestonesOf(config, "a/b/c", "open", 10)).toEqual([]);
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe("milestonesOf, hardening", () => {
    it("refuses redirects, sets a timeout and caps the page size", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([]));
        vi.stubGlobal("fetch", fetcher);

        await milestonesOf(config, "o/p", "open", 500);

        const [url, init] = fetcher.mock.calls[0] as [string, { redirect: string; signal: unknown }];
        expect(init.redirect).toBe("error");
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(url).toContain("per_page=30");
    });

    it("clamps a limit above the cap", async () => {
        const many = Array.from({ length: 31 }, (_, i) => milestone(i + 1));
        vi.stubGlobal("fetch", vi.fn(async () => answer(many)));

        expect(await milestonesOf(config, "o/p", "open", 500)).toHaveLength(30);
    });

    it("keeps the last good answer when a later 200 is not a list", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1)])));
        await milestonesOf(config, "o/p", "open", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({ message: "odd" })));
        await milestonesOf(config, "o/p", "open", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 502)));
        expect(await milestonesOf(config, "o/p", "open", 10)).toHaveLength(1);
    });

    it("lists nothing when the kept answer is not JSON", async () => {
        const { storeFor } = await import("../store.js");
        await storeFor(config).set("stale:github-milestones:o/p:open", "{not json", 0);
        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 500)));

        expect(await milestonesOf(config, "o/p", "open", 10)).toEqual([]);
    });
});

describe("percentClosed", () => {
    it("is closed over the whole, and 0 for no issues", () => {
        expect(percentClosed(3, 1)).toBe(75);
        expect(percentClosed(0, 0)).toBe(0);
        expect(percentClosed(0, 4)).toBe(0);
        expect(percentClosed(2, 0)).toBe(100);
    });

    it("reads 99 until every issue is closed", () => {
        expect(percentClosed(199, 1)).toBe(99);
    });
});

describe("MilestonesView", () => {
    const view = (rows: Parameters<typeof MilestonesView>[0]["rows"], heading?: string) =>
        renderToStaticMarkup(<MilestonesView rows={rows} heading={heading} config={config} theme={config.theme} />);

    it("draws 3 closed and 1 open as a 75 percent progressbar, with title, counts and due date", () => {
        const html = view([{ title: "v1.0", number: 1, open: 1, closed: 3, dueOn: "2026-12-31T00:00:00Z" }], "Roadmap");

        expect(html).toContain("Roadmap");
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-label="v1.0"');
        expect(html).toContain('aria-valuenow="75"');
        expect(html).toContain('aria-valuemin="0"');
        expect(html).toContain('aria-valuemax="100"');
        expect(html).toContain("3 of 4");
        expect(html).toContain("75% closed");
        expect(html).toContain("3 closed");
        expect(html).toContain("1 open");
        expect(html).toContain("due December 31, 2026");
    });

    it("prints the due date on the day GitHub sent, whatever the site zone", async () => {
        const west = defineConfig({ site: { name: "Test", url: "https://test.example" }, timeZone: "America/Los_Angeles" });
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1, { due_on: "2026-12-31T00:00:00Z" })])));

        const rows = await milestonesOf(west, "o/p", "open", 10);
        const html = renderToStaticMarkup(<MilestonesView rows={rows} config={west} theme={west.theme} />);

        expect(html).toContain("due December 31, 2026");
    });

    it("shows no date, not Invalid Date, for a milestone with none", () => {
        const html = view([{ title: "later", number: 2, open: 1, closed: 1, dueOn: null }]);

        expect(html).not.toContain("due");
        expect(html).not.toContain("Invalid");
    });

    it("renders zero issues as 0 percent, not NaN, and draws no bar", () => {
        const html = view([{ title: "empty", number: 3, open: 0, closed: 0, dueOn: null }]);

        expect(html).toContain("0% closed");
        expect(html).not.toContain("NaN");
        expect(html).not.toContain('role="progressbar"');
    });

    it("escapes the title", () => {
        const html = view([{ title: "<b>x</b>", number: 4, open: 1, closed: 1, dueOn: null }]);

        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).not.toContain("<b>x</b>");
    });

    it("says so on one plain line when there is nothing", () => {
        expect(view([])).toContain("Nothing listed.");
    });
});

describe("the milestones block", () => {
    const run = async (props: Record<string, unknown>) => {
        const block = createBlockRegistry(config).get("milestones")!;
        const node = await block.component({ props, slots: {}, theme: config.theme } as never);
        return renderToStaticMarkup(<>{node}</>);
    };

    it("is registered, with repo required", () => {
        const block = createBlockRegistry(config).get("milestones");

        expect(block?.fields.map((f) => f.name)).toEqual(["repo", "state", "limit", "heading"]);
        expect(block?.fields.filter((f) => f.required).map((f) => f.name)).toEqual(["repo"]);
    });

    it("renders a fixture of milestones as bars", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1), milestone(2, { closed_issues: 0, open_issues: 0, due_on: null })])));

        const html = await run({ repo: "o/p", heading: "Roadmap" });

        expect(html).toContain('aria-valuenow="75"');
        expect(html).toContain("v2.0");
        expect(html).not.toContain("NaN");
    });

    it("renders the kept answer when the fetch fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([milestone(1)])));
        await run({ repo: "o/p" });

        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 502)));
        const html = await run({ repo: "o/p" });

        expect(html).toContain('aria-valuenow="75"');
    });

    it("treats an unknown state as open", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([]));
        vi.stubGlobal("fetch", fetcher);

        await run({ repo: "o/p", state: "nope" });

        expect(fetcher.mock.calls[0][0]).toContain("milestones?state=open");
    });
});
