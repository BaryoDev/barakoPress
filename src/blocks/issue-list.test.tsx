import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { forgetInProcessStore } from "../store.js";
import { createBlockRegistry } from "./registry.js";
import { IssueListView, issueAge, issuesByLabel, parseRepos } from "./issue-list.js";

/*
 * The issueList block (#234): open issues with one label from public repositories. The API is
 * stubbed, so these read no network.
 */

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });
const NOW = Date.parse("2026-10-30T12:00:00Z");

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: `Issue ${number}`,
    state: "open",
    created_at: `2026-10-${String(10 + number).padStart(2, "0")}T00:00:00Z`,
    ...extra,
});

const MIXED = [
    issue(1),
    issue(2, { pull_request: { url: "https://api.github.com/repos/o/p/pulls/2" } }),
    issue(3, { state: "closed" }),
    issue(4),
];

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

describe("issuesByLabel", () => {
    it("lists only the open issues, dropping pull requests and closed ones", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));

        const rows = await issuesByLabel(config, ["o/p"], "known-gap", 10);

        expect(rows.map((r) => r.number)).toEqual([4, 1]);
    });

    it("asks the public API for the label, open only, and sends no credentials", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([]));
        vi.stubGlobal("fetch", fetcher);

        await issuesByLabel(config, ["o/p"], "known gap", 10);

        const [url, init] = fetcher.mock.calls[0] as [string, { headers: Record<string, string> }];
        expect(url).toContain("https://api.github.com/repos/o/p/issues?state=open&labels=known%20gap");
        expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    });

    it("merges repos newest first and stops at the limit", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => answer(url.includes("/a/one/") ? [issue(1), issue(5)] : [issue(3)])),
        );

        const rows = await issuesByLabel(config, ["a/one", "b/two"], "known-gap", 2);

        expect(rows.map((r) => `${r.repo}#${r.number}`)).toEqual(["a/one#5", "b/two#3"]);
    });

    it("serves the last good answer when a later read fails", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({ message: "down" }, 503)));
        const rows = await issuesByLabel(config, ["o/p"], "known-gap", 10);

        expect(rows.map((r) => r.number)).toEqual([4, 1]);
    });

    it("serves the last good answer when the network throws", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

        expect((await issuesByLabel(config, ["o/p"], "known-gap", 10)).length).toBe(2);
    });

    it("lists nothing, and does not throw, when a read fails and nothing was kept", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 500)));

        await expect(issuesByLabel(config, ["o/p"], "known-gap", 10)).resolves.toEqual([]);
    });

    it("replaces the kept answer with the next good one, so a closed issue leaves the list", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);
        vi.stubGlobal("fetch", vi.fn(async () => answer([issue(4)])));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 502)));
        expect((await issuesByLabel(config, ["o/p"], "known-gap", 10)).map((r) => r.number)).toEqual([4]);
    });

    it("keeps the last good answer when a later 200 is not a list", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({ message: "odd" })));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 502)));
        expect((await issuesByLabel(config, ["o/p"], "known-gap", 10)).map((r) => r.number)).toEqual([4, 1]);
    });

    it("reads nothing for an empty label or no repo", async () => {
        const fetcher = vi.fn(async () => answer([]));
        vi.stubGlobal("fetch", fetcher);

        expect(await issuesByLabel(config, ["o/p"], "  ", 10)).toEqual([]);
        expect(await issuesByLabel(config, [], "known-gap", 10)).toEqual([]);
        expect(fetcher).not.toHaveBeenCalled();
    });
});

describe("parseRepos", () => {
    it("takes owner/name pairs split on commas or spaces and drops the rest", () => {
        expect(parseRepos("a/one, b/two  c/three")).toEqual(["a/one", "b/two", "c/three"]);
        expect(parseRepos("nope, a/b/c, ../x, a/one?x=1, a/one")).toEqual(["a/one"]);
        expect(parseRepos(undefined)).toEqual([]);
    });

    it("keeps at most five", () => {
        expect(parseRepos("a/1 a/2 a/3 a/4 a/5 a/6")).toHaveLength(5);
    });
});

describe("issueAge", () => {
    it("reads in the largest whole unit", () => {
        const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
        expect(issueAge(ago(0), NOW)).toBe("today");
        expect(issueAge(ago(1), NOW)).toBe("1 day ago");
        expect(issueAge(ago(9), NOW)).toBe("9 days ago");
        expect(issueAge(ago(65), NOW)).toBe("2 months ago");
        expect(issueAge(ago(800), NOW)).toBe("2 years ago");
    });
});

describe("IssueListView", () => {
    const rows = [
        { title: "A <b>bold</b> gap", number: 7, repo: "o/product", createdAt: "2026-10-20T00:00:00Z" },
    ];

    it("shows title, number, age, product and a link to the issue, with the title escaped", () => {
        const html = renderToStaticMarkup(<IssueListView rows={rows} heading="Known gaps" theme={config.theme} now={NOW} />);

        expect(html).toContain("Known gaps");
        expect(html).toContain('href="https://github.com/o/product/issues/7"');
        expect(html).toContain("A &lt;b&gt;bold&lt;/b&gt; gap");
        expect(html).toContain("product #7");
        expect(html).toContain("10 days ago");
    });

    it("says so on one plain line when there is nothing", () => {
        const html = renderToStaticMarkup(<IssueListView rows={[]} heading="Known gaps" theme={config.theme} now={NOW} />);

        expect(html).toContain("Nothing listed.");
        expect(html).not.toContain("<ul");
    });
});

describe("the issueList block", () => {
    it("is registered, with repo and label required", () => {
        const block = createBlockRegistry(config).get("issueList");

        expect(block?.fields.map((f) => f.name)).toEqual(["repo", "label", "limit", "heading"]);
        expect(block?.fields.filter((f) => f.required).map((f) => f.name)).toEqual(["repo", "label"]);
    });

    it("renders the open issues for a stored page", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        const block = createBlockRegistry(config).get("issueList")!;

        const node = await block.component({
            props: { repo: "o/product", label: "known-gap", heading: "Known gaps" },
            slots: {},
            theme: config.theme,
        } as never);
        const html = renderToStaticMarkup(<>{node}</>);

        expect(html).toContain("issues/4");
        expect(html).toContain("issues/1");
        expect(html).not.toContain("issues/2");
        expect(html).not.toContain("issues/3");
    });
});
