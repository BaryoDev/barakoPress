import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A `filterBar` over a field of the enclosing source (#129): the buttons are the field's values
 * among the rows the source read, each row carries its values, and the one hide rule is the
 * engine's. The three shapes barakocms.com filters are here: packages by one category, contributors
 * by one of several releases, and changes by kind with the release around them hidden once empty.
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
const { createSiteLayout } = await import("../screens/site-layout.js");
const { createBlockRegistry } = await import("./registry.js");
const { createBlockSchemaRoute } = await import("../routes/block-schema.js");
const { cssString, filterRule, filterToken } = await import("./filter.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown> };

const PACKAGES: Entry[] = [
    { id: "p1", slug: "auth", data: { Name: "Auth", Category: "Auth" } },
    { id: "p2", slug: "files", data: { Name: "Files", Category: "Storage" } },
    { id: "p3", slug: "sso", data: { Name: "SSO", Category: "Auth" } },
    // A category no stylesheet was written for.
    { id: "p4", slug: "mail", data: { Name: "Mail", Category: "Messaging" } },
    { id: "p5", slug: "core", data: { Name: "Core" } },
];

const CONTRIBUTORS: Entry[] = [
    { id: "c1", slug: "ana", data: { Name: "ana", Releases: "4.4.0, 4.3.0" } },
    { id: "c2", slug: "ben", data: { Name: "ben", Releases: "4.3.0" } },
    { id: "c3", slug: "cy", data: { Name: "cy", Releases: "" } },
    { id: "c4", slug: "dee", data: { Name: "dee", Releases: ["4.2.0", "4.4.0"] } },
];

const CHANGES: Entry[] = [
    { id: "x1", slug: "x1", data: { Name: "new login", Kind: "Added", Release: "4.4.0" } },
    { id: "x2", slug: "x2", data: { Name: "old api", Kind: "Removed", Release: "4.4.0" } },
    { id: "x3", slug: "x3", data: { Name: "crash", Kind: "Fixed", Release: "4.3.0" } },
    { id: "x4", slug: "x4", data: { Name: "leak", Kind: "Fixed", Release: "4.2.0" } },
];

const ODD: Entry[] = [
    // Valid JSON the CMS can hold: a lone surrogate, which percent-encoding refuses.
    { id: "o1", slug: "o1", data: { Name: "odd", Tag: "Bad\ud800x" } },
    { id: "o2", slug: "o2", data: { Name: "plain", Tag: "Good" } },
];

// One row holding 150 values, which would otherwise be 150 buttons.
const MANY: Entry[] = [
    { id: "m1", slug: "m1", data: { Name: "many", Tags: Array.from({ length: 150 }, (_, i) => `t${i}`).join(",") } },
];

const COLLECTIONS = {
    odd: { type: "odd", fields: { title: "Name" } },
    many: { type: "many", fields: { title: "Name" } },
    packages: { type: "package", fields: { title: "Name" } },
    contributors: { type: "contributor", fields: { title: "Name" } },
    changes: { type: "change", fields: { title: "Name" } },
};

const CONTENT: Record<string, Entry[]> = {
    package: PACKAGES,
    contributor: CONTRIBUTORS,
    change: CHANGES,
    odd: ODD,
    many: MANY,
};

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
            return paged([{ id: "s", data: { Name: "Academy", Url: "https://academy.example", Collections: COLLECTIONS, HeaderPath: "/site/header" } }]);
        }
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "";
            const found = pages[path];
            return found
                ? Response.json({ contract: 1, path, entry: found, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 1, items: [] });
        const [type] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        let entries = CONTENT[type];
        if (!entries) return new Response("", { status: 404 });
        for (const [key, value] of url.searchParams) {
            const m = key.match(/^filter\[(.+)\]\[eq\]$/);
            if (m) entries = entries.filter((e) => e.data[m[1]] === value);
        }
        return paged(entries);
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });
const registry = createBlockRegistry(config);

beforeEach(() => {
    pages = {};
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

/** A page body inside the site layout, whose header region is a page of its own, bound apart. */
async function withHeader(header: unknown[], body: unknown[]): Promise<string> {
    pages["/about"] = { id: "p1", slug: "about", data: { Title: "About", Slug: "about", Blocks: body } };
    pages["/site/header"] = { id: "h1", slug: "header", data: { Title: "Header", Slug: "header", Blocks: header } };
    requestHeaders = new Headers({ host: "academy.example" });
    const Page = createPage(config, registry);
    const Layout = createSiteLayout(config, { loadFonts: false });
    const inner = await Page({ params: Promise.resolve({ path: ["about"] }), searchParams: Promise.resolve({}) });
    return html(await Layout({ children: inner }));
}

const text = (value: string) => ({ type: "text", props: { value } });
const bar = (props: Record<string, unknown>) => ({ type: "filterBar", props });
const repeat = (content: unknown[]) => ({ type: "repeat", props: { content: [content] } });
const source = (props: Record<string, unknown>, content: unknown[]) => ({
    type: "source",
    props: { mode: "list", pageSize: 50, ...props, content: [content] },
});

/** The buttons' labels, in order. */
const buttons = (out: string) => [...out.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

/**
 * Each marked block's bars, its values under each bar decoded, and the first `[[marker]]` inside
 * it. `id` and `values` are the first bar's, for a block only one bar marks.
 */
function marked(out: string) {
    return [...out.matchAll(/data-bp-filter="([^"]+)" data-bp-filter-values="([^"]*)"[^>]*>(?:(?!data-bp-filter=).)*?\[\[([^\]]*)\]\]/g)].map(
        (m) => {
            const ids = m[1].split(" ");
            const byId: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
            for (const token of m[2] === "" ? [] : m[2].split(" ")) {
                const at = token.indexOf(":");
                byId[token.slice(0, at)].push(decodeURIComponent(token.slice(at + 1)));
            }
            return { ids, byId, id: ids[0], values: byId[ids[0]], marker: m[3] };
        },
    );
}

describe("the buttons", () => {
    it("are the field's values among the rows, in the order first seen, after the all button", async () => {
        const out = await page([
            source({ collection: "packages" }, [bar({ field: "Category", allLabel: "All {{count}}" }), repeat([text("[[{{item.Title}}]]")])]),
        ]);

        expect(buttons(out)).toEqual(["All 5", "Auth", "Storage", "Messaging"]);
    });

    it("are toggles with aria-pressed inside a labelled group, not a tablist", async () => {
        const out = await page([
            source({ collection: "packages" }, [bar({ field: "Category", label: "Filter packages by category" }), repeat([text("[[{{item.Title}}]]")])]),
        ]);

        const pressed = [...out.matchAll(/<button[^>]*aria-pressed="(true|false)"/g)].map((m) => m[1]);
        expect(pressed).toHaveLength(4);
        expect(pressed).toEqual(["true", "false", "false", "false"]);
        expect(out).toContain('role="group" aria-label="Filter packages by category"');
        expect(out).not.toContain('role="tab');
    });

    it("put the values an order names first, and offer none that no row holds", async () => {
        const out = await page([
            source({ collection: "packages" }, [bar({ field: "Category", order: "Messaging, Ops, Auth" }), repeat([text("[[{{item.Title}}]]")])]),
        ]);

        expect(buttons(out)).toEqual(["All", "Messaging", "Auth", "Storage"]);
    });

    it("write no rule and choose nothing at rest, so every row shows", async () => {
        const out = await page([source({ collection: "packages" }, [bar({ field: "Category" }), repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).not.toContain("data-bp-filter-values~=");
        expect(out).not.toContain("data-bp-filter-value=");
    });

    it("draw nothing when the rows hold fewer than two values", async () => {
        const out = await page([
            source({ collection: "packages", filterField: "Category", filterValue: "Auth" }, [
                bar({ field: "Category" }),
                repeat([text("[[{{item.Title}}]]")]),
            ]),
        ]);

        expect(out).toContain("[[Auth]]");
        expect(buttons(out)).toEqual([]);
    });

    it("draw nothing outside a source", async () => {
        const out = await page([bar({ field: "Category" }), text("the rest")]);

        expect(out).toContain("the rest");
        expect(buttons(out)).toEqual([]);
    });
});

describe("the rows", () => {
    it("each carry the bar's id and the value their field holds", async () => {
        const out = await page([source({ collection: "packages" }, [bar({ field: "Category" }), repeat([text("[[{{item.Title}}]]")])])]);

        const rows = marked(out);
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => [r.marker, r.values])).toEqual([
            ["Auth", ["Auth"]],
            ["Files", ["Storage"]],
            ["SSO", ["Auth"]],
            ["Mail", ["Messaging"]],
            // No category is no value, so any choice hides it.
            ["Core", []],
        ]);
        expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    });

    it("hold every value of a field split on the separator, or of a list", async () => {
        const out = await page([
            source({ collection: "contributors" }, [
                bar({ field: "Releases", separator: ",", allLabel: "Everyone" }),
                repeat([text("[[{{item.Title}}]]")]),
            ]),
        ]);

        expect(buttons(out)).toEqual(["Everyone", "4.4.0", "4.3.0", "4.2.0"]);
        expect(marked(out).map((r) => [r.marker, r.values])).toEqual([
            ["ana", ["4.4.0", "4.3.0"]],
            ["ben", ["4.3.0"]],
            ["cy", []],
            ["dee", ["4.2.0", "4.4.0"]],
        ]);
    });

    it("are not marked in a source with no bar, so the page renders as it did", async () => {
        const out = await page([source({ collection: "packages" }, [repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).toContain("[[Auth]]");
        expect(out).not.toContain("data-bp-filter");
    });

    it("of a source nested in a row carry the outer row's value, so the outer bar hides them with it", async () => {
        const out = await page([
            source({ collection: "packages", filterField: "Category", filterValue: "Storage" }, [
                bar({ field: "Name" }),
                repeat([text("[[outer {{item.Title}}]]"), source({ collection: "changes" }, [repeat([text("[[inner {{item.Title}}]]")])])]),
            ]),
        ]);

        // What the nested source expands into is part of the outer row, so it carries the outer
        // row's value and never its own title.
        const rows = marked(out);
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => r.marker)).toEqual([
            "outer Files",
            "inner new login",
            "inner old api",
            "inner crash",
            "inner leak",
        ]);
        expect(rows.every((r) => r.ids.length === 1 && r.values.length === 1 && r.values[0] === "Files")).toBe(true);
    });

    it("of a nested source with its own bar carry the inner bar's mark as well as the outer row's", async () => {
        const out = await page([
            source({ collection: "packages", filterField: "Category", filterValue: "Storage" }, [
                bar({ field: "Name" }),
                repeat([
                    text("[[outer {{item.Title}}]]"),
                    source({ collection: "changes" }, [bar({ field: "Kind" }), repeat([text("[[inner {{item.Title}}]]")])]),
                ]),
            ]),
        ]);

        expect(buttons(out)).toEqual(["All", "Added", "Removed", "Fixed"]);
        const rows = marked(out).filter((r) => r.marker.startsWith("inner "));
        expect(rows).toHaveLength(4);
        const outer = marked(out).find((r) => r.marker === "outer Files")!.id;
        for (const row of rows) {
            expect(row.ids).toHaveLength(2);
            expect(row.byId[outer]).toEqual(["Files"]);
        }
        const inner = rows[0].ids.find((id) => id !== outer)!;
        expect(rows.map((r) => r.byId[inner])).toEqual([["Added"], ["Removed"], ["Fixed"], ["Fixed"]]);
    });
});

describe("odd input", () => {
    it("renders a row holding a lone surrogate, bar and all", async () => {
        const out = await page([source({ collection: "odd" }, [bar({ field: "Tag" }), repeat([text("[[{{item.Title}}]]")])])]);

        expect(out).toContain("[[odd]]");
        expect(buttons(out)).toHaveLength(3);
        expect(() => filterRule("f1", "Bad\ud800x")).not.toThrow();
        expect(filterToken("Bad\ud800x")).toBe("Bad%EF%BF%BDx");
    });

    it("offers at most a hundred values, and marks rows only with values it offers", async () => {
        const out = await page([
            source({ collection: "many" }, [bar({ field: "Tags", separator: "," }), repeat([text("[[{{item.Title}}]]")])]),
        ]);

        const labels = buttons(out);
        expect(labels).toHaveLength(101);
        expect(labels[100]).toBe("t99");
        const rows = marked(out);
        expect(rows).toHaveLength(1);
        expect(rows[0].values).toHaveLength(100);
    });

    it("gives identical bars in two separate binds two ids, as a region and a page body are bound", async () => {
        const blocks = [source({ collection: "packages" }, [bar({ field: "Category" }), repeat([text("[[{{item.Title}}]]")])])];
        const out = await withHeader(blocks, blocks);

        const rows = marked(out);
        expect(rows).toHaveLength(10);
        const ids = [...new Set(rows.map((r) => r.id))];
        expect(ids).toHaveLength(2);
        expect(ids).toContain("f1-header");
        expect(ids).toContain("f1-body");
    });

    it("renders the same page twice to the same bytes", async () => {
        const blocks = [source({ collection: "packages" }, [bar({ field: "Category" }), repeat([text("[[{{item.Title}}]]")])])];
        const first = await withHeader(blocks, blocks);
        forgetCachedReads();
        const second = await withHeader(blocks, blocks);

        expect(marked(first)).toHaveLength(10);
        expect(second).toBe(first);
    });
});

describe("a grouped source", () => {
    const changelog = (extra: Record<string, unknown>) =>
        source({ collection: "changes", groupBy: "Release" }, [
            bar({ field: "Kind", ...extra }),
            text("[[release {{group.key}}]]"),
            repeat([text("[[change {{item.Title}}]]")]),
        ]);

    it("draws the bar once, ahead of the groups", async () => {
        const out = await page([changelog({})]);

        expect(buttons(out)).toEqual(["All", "Added", "Removed", "Fixed"]);
        expect(out.match(/role="group"/g)).toHaveLength(1);
        expect(out.indexOf('role="group"')).toBeLessThan(out.indexOf("[[release 4.4.0]]"));
    });

    it("honours only a bar at the top level of a grouped source, and marks nothing for one inside a band", async () => {
        const out = await page([
            source({ collection: "changes", groupBy: "Release" }, [
                { type: "section", props: { content: [[bar({ field: "Kind" })]] } },
                text("[[release {{group.key}}]]"),
                repeat([text("[[change {{item.Title}}]]")]),
            ]),
        ]);

        expect(out).toContain("[[change leak]]");
        expect(buttons(out)).toEqual([]);
        expect(out).not.toContain("data-bp-filter");
    });

    it("keeps the bar out of every group, so hiding a group never hides the bar", async () => {
        const out = await page([changelog({ hideEmptyGroups: true })]);

        const wrappers = out.match(/<div data-block="filterBar"[^>]*>/g) ?? [];
        expect(wrappers).toHaveLength(1);
        expect(wrappers[0]).not.toContain("data-bp-filter");
    });

    it("marks a group's own blocks with every value its rows hold, with hideEmptyGroups", async () => {
        const out = await page([changelog({ hideEmptyGroups: true })]);

        const blocks = marked(out);
        expect(blocks.map((b) => [b.marker, b.values])).toEqual([
            ["release 4.4.0", ["Added", "Removed"]],
            ["change new login", ["Added"]],
            ["change old api", ["Removed"]],
            ["release 4.3.0", ["Fixed"]],
            ["change crash", ["Fixed"]],
            ["release 4.2.0", ["Fixed"]],
            ["change leak", ["Fixed"]],
        ]);
        expect(new Set(blocks.map((b) => b.id)).size).toBe(1);
    });

    it("leaves a group's own blocks unmarked without it, so a group left empty stays", async () => {
        const out = await page([changelog({})]);

        const blocks = marked(out);
        expect(blocks).toHaveLength(4);
        expect(blocks.every((b) => b.marker.startsWith("change "))).toBe(true);
    });
});

describe("the hide rule", () => {
    it("hides the rows of one bar whose values do not hold the chosen one, over an inline display", () => {
        expect(filterRule("f1-abc", "Auth")).toBe(
            '[data-bp-filter~="f1-abc"]:not([data-bp-filter-values~="f1-abc\\3a Auth"]){display:none!important}',
        );
    });

    it("keeps any value inside its string", () => {
        const hostile = `a" ] , * { display: block } </style><script>x</script> \\ '`;
        const rule = filterRule("f1", hostile);

        // Two strings, four quotes, and nothing the value held survives as markup or a new selector.
        expect(rule.match(/"/g)).toHaveLength(4);
        expect(rule).not.toContain("<");
        expect(rule).not.toContain("{ display: block }");
        expect(rule.endsWith("{display:none!important}")).toBe(true);
        expect(rule.match(/\{/g)).toHaveLength(1);
    });

    it("writes the id and the token as CSS strings nothing can leave", () => {
        const out = cssString(`a"b\\c</style>{}\n`);

        expect(out.match(/"/g)).toHaveLength(2);
        expect(out).not.toContain("<");
        expect(out).not.toContain("{");
        expect(out).not.toContain("\n");
        expect(out).toBe('"a\\22 b\\5c c\\3c \\2f style\\3e \\7b \\7d \\a "');
    });

    it("matches a value with a space as one token", () => {
        expect(filterRule("f1", "a b")).toContain('~="f1\\3a a\\25 20b"');
        expect(filterToken("Security fix")).toBe("Security%20fix");
        expect(cssString("Security%20fix")).toBe('"Security\\25 20fix"');
    });
});

describe("the schema", () => {
    it("publishes the bar and its fields through /api/blocks for an editor", async () => {
        const GET = createBlockSchemaRoute(createBlockRegistry(defineConfig({ site: { name: "T", url: "https://t.example" } })));
        const body = (await GET().json()) as {
            blocks: { type: string; layer: string; fields: { name: string; kind: string; required?: boolean; bindable: boolean }[] }[];
        };

        const block = body.blocks.find((b) => b.type === "filterBar");
        expect(block?.layer).toBe("data");
        const fields = block?.fields ?? [];
        expect(fields.map((f) => [f.name, f.kind])).toEqual([
            ["field", "text"],
            ["order", "text"],
            ["separator", "text"],
            ["allLabel", "text"],
            ["label", "text"],
            ["hideEmptyGroups", "boolean"],
            ["state", "text"],
        ]);
        expect(fields.find((f) => f.name === "field")?.required).toBe(true);
        expect(fields.find((f) => f.name === "state")?.bindable).toBe(false);
    });
});
