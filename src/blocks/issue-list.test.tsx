import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { forgetInProcessStore, storeFor } from "../store.js";
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
    // The two that must be dropped carry the newest dates, so a missing filter changes the first row.
    issue(2, { pull_request: { url: "https://api.github.com/repos/o/p/pulls/2" }, created_at: "2026-10-29T00:00:00Z" }),
    issue(3, { state: "closed", created_at: "2026-10-28T00:00:00Z" }),
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

        expect(rows).toHaveLength(2);
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

    it("bounds the outbound read: no redirect, a timeout, one full page", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([]));
        vi.stubGlobal("fetch", fetcher);
        const timeout = vi.spyOn(AbortSignal, "timeout");
        const slow = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsTimeoutMs: 1234 });

        await issuesByLabel(slow, ["o/p"], "known-gap", 10);

        const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
        expect(init.redirect).toBe("error");
        expect(init.signal).toBeDefined();
        expect(timeout).toHaveBeenCalledWith(1234);
        expect(url).toContain("per_page=100");
    });

    it("revalidates on a fixed window when the site set no backstop", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([]));
        vi.stubGlobal("fetch", fetcher);
        const none = defineConfig({ site: { name: "Test", url: "https://test.example" }, backstopSeconds: 0 });

        await issuesByLabel(none, ["o/p"], "known-gap", 10);

        const [, init] = fetcher.mock.calls[0] as [string, { next: { revalidate: unknown } }];
        expect(init.next.revalidate).toBe(300);
    });

    it("keeps the last good answer when a 200 is not a list of issues", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({ message: "gateway page" })));
        const rows = await issuesByLabel(config, ["o/p"], "known-gap", 10);

        expect(rows.map((r) => r.number)).toEqual([4, 1]);
    });

    it("stores an empty list, since no open issues is an answer", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "known-gap", 10);
        vi.stubGlobal("fetch", vi.fn(async () => answer([])));
        expect(await issuesByLabel(config, ["o/p"], "known-gap", 10)).toEqual([]);
        expect(await storeFor(config).get("stale:github-issues:o/p:known-gap")).toBe("[]");

        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 502)));
        expect(await issuesByLabel(config, ["o/p"], "known-gap", 10)).toEqual([]);
        expect(await storeFor(config).get("stale:github-issues:o/p:known-gap")).toBe("[]");
    });

    it("lists nothing when the kept answer is not valid JSON", async () => {
        await storeFor(config).set("stale:github-issues:o/p:known-gap", "{nope", 0);
        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 500)));

        expect(await issuesByLabel(config, ["o/p"], "known-gap", 10)).toEqual([]);
    });

    it("keeps one answer for a label however it is cased", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer(MIXED)));
        await issuesByLabel(config, ["o/p"], "Known-Gap", 10);

        vi.stubGlobal("fetch", vi.fn(async () => answer({}, 503)));
        expect((await issuesByLabel(config, ["o/p"], "known-gap", 10)).length).toBe(2);
    });

    it("merges repos newest first and stops at the limit", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => answer(url.includes("/a/one/") ? [issue(1), issue(3)] : [issue(5)])),
        );

        const rows = await issuesByLabel(config, ["a/one", "b/two"], "known-gap", 2);

        // The newest one is in the second repo, so a plain concat and a sort give different lists.
        expect(rows.map((r) => `${r.repo}#${r.number}`)).toEqual(["b/two#5", "a/one#3"]);
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

    it("changes unit at 31 and 365 days, and reads a future or unreadable date as today", () => {
        const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
        expect(issueAge(ago(30), NOW)).toBe("30 days ago");
        expect(issueAge(ago(31), NOW)).toBe("1 month ago");
        expect(issueAge(ago(364), NOW)).toBe("12 months ago");
        expect(issueAge(ago(365), NOW)).toBe("1 year ago");
        expect(issueAge(ago(-5), NOW)).toBe("today");
        expect(issueAge("not a date", NOW)).toBe("today");
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

    it("stops at the block's limit", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => answer([issue(1), issue(2), issue(3)])));
        const block = createBlockRegistry(config).get("issueList")!;

        const node = await block.component({ props: { repo: "o/product", label: "known-gap", limit: 1 }, slots: {}, theme: config.theme } as never);
        const html = renderToStaticMarkup(<>{node}</>);

        expect(html).toContain("issues/3");
        expect(html).not.toContain("issues/2");
        expect(html).not.toContain("issues/1");
    });

    it("reads at most five of the repositories it was given", async () => {
        const fetcher = vi.fn(async (..._args: unknown[]) => answer([]));
        vi.stubGlobal("fetch", fetcher);
        const block = createBlockRegistry(config).get("issueList")!;

        await block.component({ props: { repo: "a/1 a/2 a/3 a/4 a/5 a/6 a/7", label: "known-gap" }, slots: {}, theme: config.theme } as never);

        expect(fetcher).toHaveBeenCalledTimes(5);
    });
});
