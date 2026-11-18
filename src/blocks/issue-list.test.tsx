import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The issueList block (#234). Nothing here reaches a network: fetch is stubbed.
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
const { isRows, openIssues } = await import("../issues.js");

let dir: string;
const configFor = (locale?: string) =>
    defineConfig({ site: { name: "Test", url: "https://test.example" }, ...(locale ? { locale } : {}), synced: { snapshotDir: dir } });

async function html(node: ReactNode): Promise<string> {
    const stream = await renderToReadableStream(node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function render(raw: unknown, locale?: string): Promise<string> {
    const config = configFor(locale);
    const blocks = resolveBlocks(raw, createBlockRegistry(config), { perViewer: false });
    return html(<BlockList blocks={blocks} theme={config.theme} />);
}

const list = (props: Record<string, unknown> = {}) => [
    { type: "issueList", props: { repos: ["BaryoDev/kinspot"], label: "known-gap", heading: "Known gaps", ...props } },
];

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const issue = (number: number, title: string, days: number, extra: Record<string, unknown> = {}) => ({
    number,
    title,
    state: "open",
    created_at: ago(days),
    html_url: `https://github.com/BaryoDev/kinspot/issues/${number}`,
    ...extra,
});

/** A stub that answers each repo from a table keyed by the owner/name in the URL. */
function serve(table: Record<string, unknown[] | number>) {
    const fn = vi.fn(async (url: string) => {
        const repo = /repos\/([^/]+\/[^/]+)\/issues/.exec(url)?.[1] ?? "";
        const body = table[repo] ?? table[repo.toLowerCase()] ?? Object.entries(table).find(([k]) => k.toLowerCase() === repo.toLowerCase())?.[1];
        if (typeof body === "number") return new Response("{}", { status: body });
        if (!body) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify(body));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
}
const offline = () =>
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
            throw new TypeError("fetch failed");
        }),
    );

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "press-issues-"));
    forgetInProcessStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe("the issueList block", () => {
    it("renders only the open issues from a mixed fixture, each with title, number, product, age and link", async () => {
        serve({
            "BaryoDev/kinspot": [
                issue(12, "Open issue", 3),
                issue(13, "A pull request", 1, { pull_request: { url: "x" } }),
                issue(14, "A closed one", 2, { state: "closed" }),
            ],
        });
        const out = await render(list());

        expect(out).toContain("Known gaps");
        expect(out).toContain("Open issue");
        expect(out).not.toContain("A pull request");
        expect(out).not.toContain("A closed one");
        expect(out).toContain("kinspot");
        expect(out).toContain("#12");
        expect(out).toContain("3 days ago");
        expect(out).toContain('href="https://github.com/BaryoDev/kinspot/issues/12"');
    });

    it("asks the API for open issues with the label and a page size", async () => {
        const fetch = serve({ "BaryoDev/kinspot": [] });
        await render(list({ limit: 5 }));
        expect(fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/BaryoDev/kinspot/issues?state=open&labels=known-gap&per_page=100");
    });

    it("merges two repositories newest first and applies the limit after the merge", async () => {
        serve({
            "BaryoDev/kinspot": [issue(1, "Kin old", 9), issue(2, "Kin new", 1)],
            "BaryoDev/brew": [issue(7, "Brew middle", 4), issue(8, "Brew oldest", 20)],
        });
        const out = await render(list({ repos: ["BaryoDev/kinspot", "BaryoDev/brew"], limit: 3 }));

        expect(out.indexOf("Kin new")).toBeGreaterThan(-1);
        expect(out.indexOf("Kin new")).toBeLessThan(out.indexOf("Brew middle"));
        expect(out.indexOf("Brew middle")).toBeLessThan(out.indexOf("Kin old"));
        expect(out).not.toContain("Brew oldest");
        expect(out).toContain("brew");
    });

    it("keeps the other repository when one of two fails", async () => {
        serve({ "BaryoDev/kinspot": 500, "BaryoDev/brew": [issue(7, "Brew item", 2)] });
        const out = await render(list({ repos: ["BaryoDev/kinspot", "BaryoDev/brew"] }));
        expect(out).toContain("Brew item");
        expect(out).not.toContain("undefined");
    });

    it("draws the snapshot when the fetch fails, after the window has passed", async () => {
        serve({ "BaryoDev/kinspot": [issue(12, "Kept issue", 3)] });
        await render(list());

        const offlineFetch = vi.fn(async () => {
            throw new TypeError("fetch failed");
        });
        vi.stubGlobal("fetch", offlineFetch);
        forgetInProcessStore();
        const real = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(real + 2 * 3600_000);
        const out = await render(list());

        expect(offlineFetch).toHaveBeenCalledTimes(1);
        expect(out).toContain("Kept issue");
        expect(out).toContain("#12");
    });

    it("draws the plain line when the list is empty and the site wrote one", async () => {
        serve({ "BaryoDev/kinspot": [] });
        const out = await render(list({ emptyText: "Nothing listed." }));
        expect(out).toContain("Nothing listed.");
        expect(out).toContain("Known gaps");
        expect(out).toContain('data-press="issue-list"');
    });

    it("draws no card at all when the list is empty and no line was written", async () => {
        serve({ "BaryoDev/kinspot": [] });
        const out = await render(list());
        expect(out).not.toContain("issue-list");
        expect(out).not.toContain("Known gaps");
    });

    it("with no network, no snapshot and no line, draws nothing and does not throw", async () => {
        offline();
        const out = await render(list());
        expect(out).not.toContain("issue-list");
        expect(out).not.toContain("undefined");
    });

    it("encodes a label with a space or a slash", async () => {
        const fetch = serve({ "BaryoDev/kinspot": [issue(1, "x", 1)] });
        await render(list({ label: "good first/issue&x=1" }));
        const url = String(fetch.mock.calls[0][0]);
        expect(url).toContain("labels=good%20first%2Fissue%26x%3D1&");
        expect(new URL(url).searchParams.get("labels")).toBe("good first/issue&x=1");
        expect(new URL(url).searchParams.get("state")).toBe("open");
    });

    it("makes no request and does not crash for a bad repository id", async () => {
        const fetch = serve({});
        for (const bad of ["../x", "a/..", "a/b/c", "nope", "a b/c", "-a/b", `${"a".repeat(101)}/b`]) {
            const out = await render(list({ repos: [bad], emptyText: "none" }));
            // Nothing was read, which is not the same as nothing listed.
            expect(out).not.toContain("issue-list");
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it("refuses a label with a comma or over 50 characters, with no request", async () => {
        const fetch = serve({ "BaryoDev/kinspot": [issue(1, "x", 1)] });
        expect(await render(list({ label: "a,b", emptyText: "none" }))).not.toContain("issue-list");
        expect(await render(list({ label: "l".repeat(51), emptyText: "none" }))).not.toContain("issue-list");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("draws no empty line when every read failed and nothing was kept", async () => {
        serve({ "BaryoDev/kinspot": 500, "BaryoDev/brew": 404 });
        const out = await render(list({ repos: ["BaryoDev/kinspot", "BaryoDev/brew"], emptyText: "Nothing listed." }));
        expect(out).not.toContain("Nothing listed.");
        expect(out).not.toContain("issue-list");
    });

    it("skips a null entry, a 404 repository and a repository listed twice", async () => {
        const fetch = serve({ "BaryoDev/kinspot": [null, issue(1, "Fine", 1)], "BaryoDev/gone": 404 });
        const out = await render(list({ repos: ["BaryoDev/gone", "BaryoDev/kinspot", "baryodev/KINSPOT"] }));
        expect(out).toContain("Fine");
        expect(out.match(/issue-list-row/g)).toHaveLength(1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("keeps an issue whose date cannot be read and shows no age for it", async () => {
        serve({ "BaryoDev/kinspot": [issue(1, "No date", 1, { created_at: "soon" }), issue(2, "Has date", 2)] });
        const out = await render(list());
        expect(out).toContain("No date");
        expect(out).toContain("Has date");
        expect(out.match(/<time/g)).toHaveLength(1);
        expect(out.indexOf("Has date")).toBeLessThan(out.indexOf("No date"));
    });

    it("puts the real instant in the time element", async () => {
        const created = "2026-11-10T08:30:00.000Z";
        serve({ "BaryoDev/kinspot": [issue(1, "Dated", 1, { created_at: created })] });
        expect(await render(list())).toContain(`dateTime="${created}"`);
    });

    it("shows the repository name as this block wrote it, not as the first read fetched it", async () => {
        serve({ "BaryoDev/kinspot": [issue(1, "Shared", 1)] });
        const out = await render([...list({ repos: ["BaryoDev/KinSpot"] }), ...list({ repos: ["baryodev/kinspot"] })]);
        expect(out).toContain("<span>KinSpot</span>");
        expect(out).toContain("<span>kinspot</span>");
    });

    it("makes two calls and two lists for two labels on one repository", async () => {
        const fetch = vi.fn(async (url: string) =>
            new Response(JSON.stringify(url.includes("labels=a&") ? [issue(1, "Under A", 1)] : [issue(2, "Under B", 1)])),
        );
        vi.stubGlobal("fetch", fetch);
        const out = await render([...list({ label: "a" }), ...list({ label: "b" })]);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(out).toContain("Under A");
        expect(out).toContain("Under B");
    });

    it("shares one call between blocks that differ only in limit, and cuts each to its own", async () => {
        const rows = [1, 2, 3, 4, 5, 6].map((n) => issue(n, `Row ${n}`, n));
        const fetch = serve({ "BaryoDev/kinspot": rows });
        const out = await render([...list({ limit: 3 }), ...list({ limit: 5 })]);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(out.match(/issue-list-row/g)).toHaveLength(8);
    });

    it("reads at most ten repositories when given more, and a stored list of eleven hides the block", async () => {
        const fetch = serve({});
        const repos = Array.from({ length: 11 }, (_, i) => `o/r${i}`);
        await openIssues(configFor(), { repos, label: "x" });
        expect(fetch).toHaveBeenCalledTimes(10);

        fetch.mockClear();
        expect(await render(list({ repos, emptyText: "none" }))).not.toContain("issue-list");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("refuses a kept value with a link off github.com or a number that is not an integer", () => {
        const row = { repo: "o/r", title: "t", url: "https://github.com/o/r/issues/1", number: 1 };
        expect(isRows([row])).toBe(true);
        expect(isRows([{ ...row, url: "javascript:alert(1)" }])).toBe(false);
        expect(isRows([{ ...row, number: 1.5 }])).toBe(false);
        expect(isRows([{ ...row, number: "1" }])).toBe(false);
    });

    it("skips a bad id and still reads the good one", async () => {
        const fetch = serve({ "BaryoDev/kinspot": [issue(1, "Good", 1)] });
        const out = await render(list({ repos: ["../x", "BaryoDev/kinspot"] }));
        expect(out).toContain("Good");
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("draws a title that contains HTML as text", async () => {
        serve({ "BaryoDev/kinspot": [issue(5, '<img src=x onerror=alert(1)><script>alert(2)</script>', 1)] });
        const out = await render(list());
        expect(out).not.toContain("<img src=x");
        expect(out).not.toContain("<script>alert");
        expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("builds the link itself when the API's html_url is not on github.com", async () => {
        serve({
            "BaryoDev/kinspot": [
                issue(5, "Elsewhere", 1, { html_url: "https://evil.example/BaryoDev/kinspot/issues/5" }),
                issue(6, "Script", 2, { html_url: "javascript:alert(1)" }),
                issue(7, "Missing", 3, { html_url: undefined }),
            ],
        });
        const out = await render(list());
        expect(out).toContain('href="https://github.com/BaryoDev/kinspot/issues/5"');
        expect(out).toContain('href="https://github.com/BaryoDev/kinspot/issues/6"');
        expect(out).toContain('href="https://github.com/BaryoDev/kinspot/issues/7"');
        expect(out).not.toContain("evil.example");
        expect(out).not.toContain("javascript:");
    });

    it("writes the age in the site's locale, not in English chosen here", async () => {
        serve({ "BaryoDev/kinspot": [issue(5, "Age", 3)] });
        const out = await render(list(), "de");
        expect(out).toContain("vor 3 Tagen");
        expect(out).not.toContain("3 days ago");
    });

    it("says nothing the tenant did not say: no heading, no line", async () => {
        serve({ "BaryoDev/kinspot": [issue(5, "Only", 1)] });
        const out = await render(list({ heading: undefined }));
        expect(out).toContain("Only");
        expect(out).not.toContain("<h2");
        expect(out).not.toContain("Nothing");
    });

    it("does not render a block whose required fields are missing", async () => {
        const fetch = serve({});
        const out = await render([{ type: "issueList", props: { heading: "x" } }]);
        expect(out).not.toContain("issue-list");
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe("the issueList block in /api/blocks", () => {
    it("publishes its fields", async () => {
        const res = createBlockSchemaRoute(createBlockRegistry(configFor()))();
        const body = (await res.json()) as { blocks: { type: string; label: string; fields: { name: string; kind: string; required?: boolean }[] }[] };
        const found = body.blocks.find((b) => b.type === "issueList");
        expect(found?.label).toBe("Issue list");
        expect(found?.fields.map((f) => f.name)).toEqual(["repos", "label", "limit", "heading", "emptyText"]);
        expect(found?.fields[0]).toMatchObject({ kind: "list", required: true });
        expect(found?.fields[1]).toMatchObject({ kind: "text", required: true });
    });
});
