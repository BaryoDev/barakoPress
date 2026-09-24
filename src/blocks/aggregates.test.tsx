import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Counts, sums and groups over a source (#128), on a request-time site: `{{count.<collection>}}`,
 * `{{count}}` inside a filtered source, `{{sum.<Field>}}` over a source's rows, and a `source` with
 * `groupBy` that repeats its content once per distinct value.
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
const { MAX_SOURCES } = await import("./data.js");

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown>; draft?: boolean };

const PACKAGES: Entry[] = [
    { id: "p1", slug: "auth", data: { Name: "Auth", Category: "Auth" } },
    { id: "p2", slug: "sso", data: { Name: "SSO", Category: "Auth" } },
    { id: "p3", slug: "files", data: { Name: "Files", Category: "Storage" } },
    { id: "p4", slug: "mail", data: { Name: "Mail", Category: "Messaging" } },
    { id: "p5", slug: "vault", data: { Name: "Vault", Category: "Auth" } },
    // Unpublished. The public API does not list it, so neither a count nor a group may include it.
    { id: "p6", slug: "secret", data: { Name: "Secret", Category: "Auth" }, draft: true },
];

const MILESTONES: Entry[] = [
    { id: "m1", slug: "m1", data: { Name: "4.4", Repository: "barakoCMS", Open: 12 } },
    { id: "m2", slug: "m2", data: { Name: "0.9", Repository: "barakoPress", Open: "7" } },
    { id: "m3", slug: "m3", data: { Name: "4.5", Repository: "barakoCMS", Open: 3 } },
    { id: "m4", slug: "m4", data: { Name: "1.0", Repository: "barakoBrew", Open: 5 } },
];

const COLLECTIONS = {
    packages: { type: "package", fields: { title: "Name" }, sort: "Name" },
    milestones: { type: "milestone", fields: { title: "Name" } },
    posts: { type: "post", fields: { title: "Name" } },
};

const CONTENT: Record<string, Entry[]> = {
    package: PACKAGES,
    milestone: MILESTONES,
    post: [
        { id: "a", slug: "a", data: { Name: "A" } },
        { id: "b", slug: "b", data: { Name: "B" } },
    ],
};

let pages: Record<string, Entry> = {};
let calls: string[] = [];
let failing: string | null = null;

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push(url.pathname + url.search);

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            return decodeURIComponent(byHost[1]) === "academy.example"
                ? Response.json({ handle: "academy" })
                : new Response("", { status: 404 });
        }
        if (tenant !== "academy") return new Response("", { status: 404 });

        const page = Number(url.searchParams.get("page") ?? "1");
        const size = Number(url.searchParams.get("pageSize") ?? "20");
        const paged = (items: unknown[]) =>
            Response.json({
                items: items.slice((page - 1) * size, page * size),
                page,
                pageSize: size,
                totalItems: items.length,
                totalPages: Math.ceil(items.length / size),
                hasNextPage: page * size < items.length,
            });
        if (url.pathname === "/api/public/site") {
            return paged([{ id: "s", data: { Name: "Academy", Url: "https://academy.example", Collections: COLLECTIONS } }]);
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
        if (type === failing) return new Response("", { status: 500 });
        const entries = CONTENT[type];
        if (!entries) return new Response("", { status: 404 });
        let listed = entries.filter((e) => !e.draft);
        for (const [key, value] of url.searchParams) {
            const m = key.match(/^filter\[(.+)\]\[eq\]$/);
            if (m) listed = listed.filter((e) => e.data[m[1]] === value);
        }
        return paged(listed);
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });
const registry = createBlockRegistry(config);

let warnings: string[] = [];

beforeEach(() => {
    calls = [];
    pages = {};
    warnings = [];
    failing = null;
    requestHeaders = null;
    forgetCachedReads();
    vi.stubGlobal("fetch", cms());
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
    });
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

async function page(blocks: unknown[], query: Record<string, string> = {}): Promise<string> {
    pages["/about"] = { id: "p1", slug: "about", data: { Title: "About", Slug: "about", Blocks: blocks } };
    requestHeaders = new Headers({ host: "academy.example" });
    const Page = createPage(config, registry);
    return html(await Page({ params: Promise.resolve({ path: ["about"] }), searchParams: Promise.resolve(query) }));
}

const text = (value: string) => ({ type: "text", props: { value } });

const source = (props: Record<string, unknown>, content: unknown[]) => ({
    type: "source",
    props: { mode: "list", ...props, content: [content] },
});

const listReads = (type: string) => calls.filter((c) => c.startsWith(`/api/public/${type}?`));

describe("count", () => {
    it("counts a collection's published entries anywhere on the page", async () => {
        const out = await page([text("[{{count.packages}} packages, {{count.posts}} posts]")]);

        expect(out).toContain("[5 packages, 2 posts]");
    });

    it("asks the public API for the smallest page and reads totalItems, not the rows", async () => {
        await page([text("{{count.packages}}")]);

        const reads = listReads("package");
        expect(reads).toHaveLength(1);
        expect(reads[0]).toContain("pageSize=1");
        expect(reads[0]).not.toContain("preview");
    });

    it("counts only published entries, the same rows the page could list", async () => {
        const out = await page([
            text("[{{count.packages}}]"),
            source({ collection: "packages", pageSize: 50 }, [{ type: "repeat", props: { content: [[text("row:{{item.Title}}")]] } }]),
        ]);

        const rows = out.match(/row:[A-Za-z]+/g) ?? [];
        expect(rows).toHaveLength(5);
        expect(out).toContain("[5]");
        expect(out).not.toContain("Secret");
    });

    it("reads a collection's count once however many times the page names it", async () => {
        const out = await page([text("{{count.packages}}"), text("again {{count.packages}}"), text("{{count.packages | number}}")]);

        expect(out).toContain("again 5");
        expect(listReads("package")).toHaveLength(1);
    });

    it("counts what a source's filter matched through {{count}} inside it", async () => {
        const out = await page([
            source({ collection: "packages", filterField: "Category", filterValue: "Auth", pageSize: 1 }, [
                text("[{{count}} for auth]"),
            ]),
        ]);

        expect(out).toContain("[3 for auth]");
        const reads = listReads("package");
        expect(reads).toHaveLength(1);
        expect(reads[0]).toContain("filter%5BCategory%5D%5Beq%5D=Auth");
    });

    it("takes the filter value from a binding, so a filtered count follows the URL", async () => {
        const out = await page(
            [source({ collection: "packages", filterField: "Category", filterValue: "{{query.c}}", pageSize: 1 }, [text("[{{count}}]")])],
            { c: "Storage" },
        );

        expect(out).toContain("[1]");
    });

    it("renders the fallback and reports it when the count cannot be read", async () => {
        failing = "package";
        const out = await page([text("[{{count.packages ?? some}}]"), text("the rest of the page")]);

        expect(out).toContain("[some]");
        expect(out).toContain("the rest of the page");
        const reported = warnings.filter((w) => w.includes("{{count.packages ?? some}}"));
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain("no value");
    });

    it("renders the fallback, and reads nothing, for a collection this tenant does not have", async () => {
        const out = await page([text("[{{count.nope ?? none}}]")]);

        expect(out).toContain("[none]");
        expect(calls.some((c) => c.startsWith("/api/public/nope"))).toBe(false);
        expect(warnings.some((w) => w.includes("{{count.nope ?? none}}"))).toBe(true);
    });

    it("reports {{count}} outside a source rather than guessing a collection", async () => {
        const out = await page([text("[{{count ?? n/a}}]")]);

        expect(out).toContain("[n/a]");
        expect(warnings.some((w) => w.includes("{{count ?? n/a}}"))).toBe(true);
    });

    it("spends one of the page's reads on each collection it counts", async () => {
        const filler = Array.from({ length: MAX_SOURCES - 1 }, () => source({ collection: "posts", pageSize: 1 }, [text("x")]));
        const out = await page([
            ...filler,
            text("[{{count.packages ?? p}}]"),
            text("[{{count.milestones ?? m}}]"),
            source({ collection: "posts", pageSize: 1 }, [text("the ninth read")]),
        ]);

        // Seven sources and the package count are the eight reads. The milestone count and the
        // last source are over the budget and read nothing.
        expect(out).toContain("[5]");
        expect(out).toContain("[m]");
        expect(out).not.toContain("the ninth read");
        expect(listReads("milestone")).toHaveLength(0);
        expect(warnings.some((w) => w.includes("{{count.milestones ?? m}}"))).toBe(true);
    });
});

describe("sum", () => {
    it("adds a numeric field over a source's rows, numbers written as text included", async () => {
        const out = await page([source({ collection: "milestones" }, [text("[{{sum.Open}} open]")])]);

        expect(out).toContain("[27 open]");
    });

    it("sums only the rows the filter kept", async () => {
        const out = await page([
            source({ collection: "milestones", filterField: "Repository", filterValue: "barakoCMS" }, [text("[{{sum.Open}}]")]),
        ]);

        expect(out).toContain("[15]");
    });

    it("renders the fallback for a field that is not a number", async () => {
        const out = await page([source({ collection: "milestones" }, [text("[{{sum.Repository ?? not a number}}]")])]);

        expect(out).toContain("[not a number]");
        expect(warnings.some((w) => w.includes("{{sum.Repository ?? not a number}}"))).toBe(true);
    });

    it("is unbound outside a source", async () => {
        const out = await page([text("[{{sum.Open ?? none}}]")]);

        expect(out).toContain("[none]");
        expect(warnings.some((w) => w.includes("unbound scope"))).toBe(true);
    });

    it("costs no read of its own", async () => {
        await page([source({ collection: "milestones" }, [text("{{sum.Open}}"), text("{{sum.Open | number}}")])]);

        expect(listReads("milestone")).toHaveLength(1);
    });
});

describe("distinct", () => {
    it("counts the different values a field holds over a source's rows", async () => {
        const out = await page([source({ collection: "milestones" }, [text("[{{distinct.Repository}} repositories]")])]);

        expect(out).toContain("[3 repositories]");
    });

    it("counts only the rows the filter kept, and a group's own rows inside a group", async () => {
        const filtered = await page([
            source({ collection: "packages", filterField: "Category", filterValue: "Auth" }, [text("[{{distinct.Category}}]")]),
        ]);
        expect(filtered).toContain("[1]");

        const grouped = await page([
            source({ collection: "milestones", groupBy: "Repository" }, [text("[{{group.key}}:{{distinct.Name}}]")]),
        ]);
        expect(grouped).toContain("[barakoCMS:2]");
        expect(grouped).toContain("[barakoPress:1]");
    });

    it("renders the fallback for a field no row holds, and is unbound outside a source", async () => {
        const out = await page([
            source({ collection: "milestones" }, [text("[{{distinct.Nothing ?? 0}}]")]),
            text("[{{distinct.Repository ?? none}}]"),
        ]);

        expect(out).toContain("[0]");
        expect(out).toContain("[none]");
    });
});

describe("groupBy", () => {
    const grouped = (extra: Record<string, unknown>) =>
        source({ collection: "milestones", groupBy: "Repository", ...extra }, [
            text("<{{group.key}}:{{group.count}}:{{sum.Open}}>"),
            { type: "repeat", props: { content: [[text("row {{item.Title}} in {{group.key}}")]] } },
        ]);

    it("repeats the content once per distinct value, in the order first seen", async () => {
        const out = await page([grouped({})]);

        const heads = out.match(/&lt;[A-Za-z]+:\d+:\d+&gt;/g) ?? [];
        expect(heads).toHaveLength(3);
        expect(heads).toEqual(["&lt;barakoCMS:2:15&gt;", "&lt;barakoPress:1:7&gt;", "&lt;barakoBrew:1:5&gt;"]);
    });

    it("iterates only that group's rows inside it", async () => {
        const out = await page([grouped({})]);

        const rows = out.match(/row [0-9.]+ in [A-Za-z]+/g) ?? [];
        expect(rows).toHaveLength(4);
        expect(rows).toEqual(["row 4.4 in barakoCMS", "row 4.5 in barakoCMS", "row 0.9 in barakoPress", "row 1.0 in barakoBrew"]);
    });

    it("follows an explicit groupOrder, and puts values it does not name after, in the order first seen", async () => {
        const out = await page([grouped({ groupOrder: "barakoBrew, barakoCMS" })]);

        const heads = out.match(/&lt;[A-Za-z]+:\d+:\d+&gt;/g) ?? [];
        expect(heads).toHaveLength(3);
        expect(heads).toEqual(["&lt;barakoBrew:1:5&gt;", "&lt;barakoCMS:2:15&gt;", "&lt;barakoPress:1:7&gt;"]);
    });

    it("groups the published rows only", async () => {
        const out = await page([
            source({ collection: "packages", groupBy: "Category", pageSize: 50 }, [text("<{{group.key}}={{group.count}}>")]),
        ]);

        const heads = out.match(/&lt;[A-Za-z]+=\d+&gt;/g) ?? [];
        expect(heads).toHaveLength(3);
        expect(heads[0]).toBe("&lt;Auth=3&gt;");
    });

    it("makes one read for every group, where four filtered sources made four", async () => {
        await page([grouped({})]);

        expect(listReads("milestone")).toHaveLength(1);
    });

    it("leaves group unbound in a source without groupBy", async () => {
        const out = await page([source({ collection: "milestones" }, [text("[{{group.key ?? whole}}]")])]);

        expect(out).toContain("[whole]");
    });

    it("renders nothing, and the rest of the page, when the grouped read fails", async () => {
        failing = "milestone";
        const out = await page([grouped({}), text("the rest of the page")]);

        expect(out).not.toContain("row ");
        expect(out).toContain("the rest of the page");
    });
});

describe("a page without counts, sums or groups", () => {
    it("makes the same reads it made before", async () => {
        await page([source({ collection: "packages", pageSize: 3 }, [{ type: "repeat", props: { content: [[text("{{item.Title}}")]] } }])]);

        const reads = listReads("package");
        expect(reads).toHaveLength(1);
        expect(reads[0]).toContain("pageSize=3");
    });

    it("leaves a word that is no scope exactly as typed", async () => {
        const out = await page([text("[{{counts.packages}}]")]);

        expect(out).toContain("[{{counts.packages}}]");
    });
});
