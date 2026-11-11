import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A `filterInput` over the rows of the enclosing source (#254): a labelled text box that hides the
 * rows whose text lacks a typed word. The rows stay server-rendered and the rule that hides them is
 * the engine's, the same family as the `filterBar` rule; the box is put away until a script can run it.
 */
let requestHeaders: Headers | null = null;
vi.mock("next/headers", () => ({
    headers: async () => {
        if (!requestHeaders) throw new Error("headers() was read");
        return requestHeaders;
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
    redirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: "NEXT_REDIRECT" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { forgetCachedReads } = await import("../delivery.js");
const { createPage } = await import("../screens/page.js");
const { createBlockRegistry } = await import("./registry.js");
const { textRule, FILTER_MISS_ATTR } = await import("./filter.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const PACKAGES: Entry[] = [
    { id: "p1", slug: "auth", data: { Name: "Auth", Category: "Auth" } },
    { id: "p2", slug: "files", data: { Name: "Files", Category: "Storage" } },
    { id: "p3", slug: "sso", data: { Name: "SSO", Category: "Auth" } },
];

const COLLECTIONS = { packages: { type: "package", fields: { title: "Name" } } };

let pages: Record<string, Entry> = {};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            return decodeURIComponent(byHost[1]) === "academy.example"
                ? Response.json({ handle: "academy" })
                : new Response("", { status: 404 });
        }
        if (tenant !== "academy") return new Response("", { status: 404 });
        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") {
            const labels = labelsOverride ? { Labels: labelsOverride } : {};
            return paged([{ id: "s", data: { Name: "Academy", Url: "https://academy.example", Collections: COLLECTIONS, ...labels } }]);
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "";
            const found = pages[path];
            return found
                ? Response.json({ contract: 2, path, entry: found, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 2, items: [] });
        const [type] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        if (type !== "package") return new Response("", { status: 404 });
        return paged(PACKAGES);
    });
}

let labelsOverride: Record<string, string> | undefined;
const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });
const registry = createBlockRegistry(config);

beforeEach(() => {
    pages = {};
    labelsOverride = undefined;
    requestHeaders = null;
    forgetCachedReads();
    vi.stubGlobal("fetch", cms());
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function html(node: ReactNode): Promise<string> {
    const stream = await renderToReadableStream(node);
    await stream.allReady;
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

async function page(blocks: unknown[]): Promise<string> {
    pages["/about"] = { id: "p1", slug: "about", data: { Title: "About", Slug: "about", Blocks: blocks } };
    requestHeaders = new Headers({ host: "academy.example" });
    const Page = createPage(config, registry);
    return html(await Page({ params: Promise.resolve({ path: ["about"] }), searchParams: Promise.resolve({}) }));
}

const text = (value: string) => ({ type: "text", props: { value } });
const input = (props: Record<string, unknown> = {}) => ({ type: "filterInput", props });
const bar = (props: Record<string, unknown>) => ({ type: "filterBar", props });
const repeat = (content: unknown[]) => ({ type: "repeat", props: { content: [content] } });
const source = (content: unknown[]) => ({ type: "source", props: { collection: "packages", mode: "list", pageSize: 50, content: [content] } });

/** The row numbers a marked block carries, in order, with the bar id each is under. */
const rows = (out: string) => [...out.matchAll(/data-bp-filter-row="([^"]+)"/g)].map((m) => m[1]);

describe("filterInput markup", () => {
    it("draws a labelled search box, put away until a script runs it, and every row", async () => {
        const out = await page([source([input(), repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).toMatch(/<div data-bp-filter-input="f1-body"[^>]* hidden=""/);
        expect(out).toMatch(/<input type="search" aria-label="Filter"/);
        for (const title of ["Auth", "Files", "SSO"]) expect(out).toContain(`[[${title}]]`);
        // Nothing is hidden at rest: the rule only matches a row the script marked.
        expect(out).toContain(textRule("f1-body"));
        expect(out).not.toContain(`${FILTER_MISS_ATTR}="`);
    });

    it("numbers the rows of the source under the box's id, one number per row", async () => {
        const out = await page([source([input(), repeat([text("[[{{item.Title}}]]"), text("{{item.Category}}")])])]);

        // Two blocks a row, so each row's number appears twice, and a row is one unit for the match.
        expect(rows(out)).toEqual(["f1-body:0", "f1-body:0", "f1-body:1", "f1-body:1", "f1-body:2", "f1-body:2"]);
    });

    it("marks the rows with the same id as a filterBar around the same source", async () => {
        const out = await page([source([bar({ field: "Category" }), input(), repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).toContain('data-bp-filter="f1-body" data-bp-filter-values="f1-body:Auth" data-bp-filter-row="f1-body:0"');
        expect(out).toContain('data-bp-filter-input="f1-body"');
        expect(out).toContain("Storage");
    });

    it("marks the rows of a source holding only a box, with no values", async () => {
        const out = await page([source([input(), repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).toContain('data-bp-filter="f1-body" data-bp-filter-values="" data-bp-filter-row="f1-body:0"');
    });

    it("adds no row attribute to a source with a bar and no box", async () => {
        const out = await page([source([bar({ field: "Category" }), repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).not.toContain("data-bp-filter-row");
        expect(out).not.toContain("data-bp-filter-input");
    });

    it("says its words from the labels, and a block's own props win", async () => {
        const defaults = await page([source([input(), repeat([text("x")])])]);
        expect(defaults).toContain('data-bp-filter-count="{count} shown"');
        expect(defaults).toContain('data-bp-filter-empty="Nothing matches that."');

        labelsOverride = { filterInput: "Find a module", filterCount: "{count} of {total}", filterEmpty: "No module for {query}" };
        forgetCachedReads();
        const labelled = await page([source([input(), repeat([text("x")])])]);
        expect(labelled).toContain('aria-label="Find a module"');
        expect(labelled).toContain('data-bp-filter-count="{count} of {total}"');
        expect(labelled).toContain('data-bp-filter-empty="No module for {query}"');

        const own = await page([source([input({ label: "Search packages", countLabel: "{count} here", emptyLabel: "None" }), repeat([text("x")])])]);
        expect(own).toContain('aria-label="Search packages"');
        expect(own).toContain('placeholder="Search packages"');
        expect(own).toContain('data-bp-filter-count="{count} here"');
        expect(own).toContain('data-bp-filter-empty="None"');
    });

    it("draws one box a source, the first", async () => {
        const out = await page([source([input(), input({ label: "Second" }), repeat([text("x")])])]);

        expect(out.match(/<input type="search"/g)).toHaveLength(1);
        expect(out).not.toContain("Second");
    });

    it("draws nothing outside a source", async () => {
        const out = await page([input()]);

        expect(out).not.toContain("<input");
    });
});

describe("textRule", () => {
    it("hides a row the script marked for this box, over an inline display, and no other", () => {
        expect(textRule("f1-body")).toBe('[data-bp-filter-miss~="f1-body"]{display:none!important}');
        expect(textRule('a"b')).not.toContain('a"b');
    });
});
