import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A source that reads a whole collection (#150), past what it may read and draw: it says what it left
 * out, keeps to a request budget, charges groups and rows to the rows' own budget, and works out a
 * sum or a distinct count once per source rather than once per row.
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
const { MAX_ALL_REQUESTS } = await import("./data.js");

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

// A changelog is a document, not a page of cards: more rows than one read of fifty.
const RELEASES: Entry[] = Array.from({ length: 120 }, (_, i) => ({
    id: `r${i}`,
    slug: `r${i}`,
    data: { Name: `v${i}`, Kind: i % 3 === 0 ? "Major" : "Minor" },
}));

const COLLECTIONS = {
    releases: { type: "release", fields: { title: "Name" } },
    packages: { type: "package", fields: { title: "Name" }, sort: "Name" },
    milestones: { type: "milestone", fields: { title: "Name" } },
    posts: { type: "post", fields: { title: "Name" } },
};

const CONTENT: Record<string, Entry[]> = {
    release: RELEASES,
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


const BIG: Entry[] = Array.from({ length: 600 }, (_, i) => ({
    id: `b${i}`,
    slug: `b${i}`,
    data: { Name: `n${i}`, Kind: `k${i % 7}`, N: i, A: "x" },
}));
CONTENT.big = BIG;
(COLLECTIONS as Record<string, unknown>).bigs = { type: "big", fields: { title: "Name" } };
CONTENT.five = BIG.slice(0, 500);
(COLLECTIONS as Record<string, unknown>).fives = { type: "five", fields: { title: "Name" } };

const rep = (content: unknown[], props: Record<string, unknown> = {}) => ({ type: "repeat", props: { ...props, content: [content] } });

describe("a source in all mode, past what it may read", () => {
    it("says how many rows it left out, and counts what the collection holds", async () => {
        const out = await page([source({ collection: "bigs", mode: "all" }, [text("[total {{count}}]"), rep([text("<{{item.Title}}>")])])]);
        expect((out.match(/&lt;n\d+&gt;/g) ?? []).length).toBe(500);
        expect(out).toContain("[total 600]");
        expect(warnings.filter((w) => w.includes("600") && w.includes("500"))).toHaveLength(1);
    });

    it("keeps a page's list requests to a budget however many sources read everything", async () => {
        const blocks = Array.from({ length: 8 }, (_, i) =>
            source({ collection: "bigs", mode: "all", filterField: "A", filterValue: "x" }, [text(`[s${i} {{count}}]`)]),
        );
        const out = await page(blocks);
        expect(listReads("big").length).toBeGreaterThan(8);
        expect(listReads("big").length).toBeLessThanOrEqual(8 + MAX_ALL_REQUESTS);
        expect(out).toContain("[s7 600]");
        expect(warnings.some((w) => w.includes("request"))).toBe(true);
    });
});

describe("rows and groups, past their budget", () => {
    it("says so when a list draws fewer rows than it read because the rows' budget ran out", async () => {
        const twenty = Array.from({ length: 20 }, (_, i) => text(i === 0 ? "<{{item.Title}}>" : "."));
        const out = await page([
            source({ collection: "fives", mode: "all" }, [rep(twenty)]),
            source({ collection: "packages", mode: "list" }, [rep([text("PKG:{{item.Title}}")])]),
            text("after both"),
        ]);
        expect(out).toContain("after both");
        expect(out).not.toContain("PKG:");
        expect(warnings.some((w) => /drew 0 of 5 rows/.test(w))).toBe(true);
    });

    it("charges a group's blocks to the rows' budget, so the page after the groups still draws", async () => {
        const out = await page([
            source({ collection: "fives", mode: "all", groupBy: "Name" }, [text("[{{group.key}}]"), text("."), text("."), rep([text("r")])]),
            text("after the groups"),
        ]);
        expect((out.match(/\[n\d+\]/g) ?? []).length).toBe(500);
        expect(out).toContain("after the groups");
    });
});

describe("a sum and a distinct count in every row", () => {
    it("are worked out once per source, not once per row", async () => {
        const t0 = Date.now();
        await page([source({ collection: "fives", mode: "all" }, [rep([text("{{item.Title}}")])])]);
        const plain = Date.now() - t0;
        const t1 = Date.now();
        const out = await page([source({ collection: "fives", mode: "all" }, [rep([text("{{item.Title}} of {{distinct.Kind}} {{sum.N}}")])])]);
        const both = Date.now() - t1;
        expect(out).toContain("n499 of 7 124750");
        expect(both).toBeLessThan(plain * 3 + 150);
    });
});
