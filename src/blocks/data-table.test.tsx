import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The dataTable block (#26): one page of a public collection as a table, paged by the API through a
 * URL parameter, read on the server and linked per row.
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

const CMS = "http://cms.test";

type Entry = { id: string; slug: string; data: Record<string, unknown>; draft?: boolean };

const STUDENTS: Entry[] = Array.from({ length: 5 }, (_, i) => ({
    id: `s${i + 1}`,
    slug: `student-${i + 1}`,
    data: { Name: `Student ${i + 1}`, Grade: 7 + i, Enrolled: `2026-0${i + 1}-15` },
}));

const COLLECTIONS = {
    students: { type: "student", fields: { title: "Name" } },
};

const CONTENT: Record<string, Entry[]> = { student: STUDENTS };

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
                ? Response.json({ contract: 2, path, entry: found, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        if (url.pathname === "/api/public/pages/navigation") return Response.json({ contract: 2, items: [] });

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


const table = (props: Record<string, unknown> = {}) => ({
    type: "dataTable",
    props: {
        collection: "students",
        pageSize: 2,
        columns: [{ field: "Title", label: "Student" }, { field: "Grade" }, { field: "Enrolled", label: "Enrolled", format: "date" }],
        ...props,
    },
});

describe("a dataTable over a public collection", () => {
    it("draws one page of rows with its headings and asks the API for only that page", async () => {
        const out = await page([table()]);
        expect(out).toContain("<table");
        expect(out).toContain(">Student</th>");
        expect(out).toContain(">Grade</th>");
        expect(out).toContain("Student 1");
        expect(out).toContain("Student 2");
        expect(out).not.toContain("Student 3");
        expect(listReads("student")).toHaveLength(1);
        expect(listReads("student")[0]).toContain("pageSize=2");
        expect(out).toContain("15 January 2026");
    });

    it("pages by URL parameter, with a previous link on page two and no next on the last", async () => {
        const second = await page([table()], { page: "2" });
        expect(second).toContain("Student 3");
        expect(second).not.toContain("Student 1<");
        expect(second).toContain('rel="prev"');
        expect(second).toContain('href="?page=1"');
        expect(second).toContain('rel="next"');
        const last = await page([table()], { page: "3" });
        expect(last).toContain("Student 5");
        expect(last).toContain('rel="prev"');
        expect(last).not.toContain('rel="next"');
    });

    it("uses the page parameter the block names", async () => {
        const out = await page([table({ pageParam: "p" })], { p: "2", page: "3" });
        expect(out).toContain("Student 3");
        expect(out).toContain('href="?p=3"');
    });

    it("links the first cell of a row through rowLink and refuses an off-site link", async () => {
        const linked = await page([table({ rowLink: "/students/{slug}" })]);
        expect(linked).toContain('href="/students/student-1"');
        const off = await page([table({ rowLink: "//evil.example/{slug}" })]);
        expect(off).toContain("Student 1");
        expect(off).not.toContain("evil.example");
    });

    it("does not print inherited properties for a column field", async () => {
        const out = await page([table({ columns: [{ field: "Title" }, { field: "constructor" }, { field: "toString" }] })]);
        expect(out).toContain("Student 1");
        expect(out).not.toContain("native code");
    });

    it("draws nothing, and does not throw, for a column whose heading is not text", async () => {
        const out = await page([table({ columns: [{ field: "Title", label: 5 }] })]);
        expect(out).not.toContain("Student 1");
        expect(out).not.toContain("<table");
    });

    it("says it is empty when the collection has no rows, and draws nothing for a collection the site lacks", async () => {
        CONTENT.student = [];
        const empty = await page([table({ empty: "No students yet" })]);
        CONTENT.student = STUDENTS;
        expect(empty).toContain("No students yet");
        const missing = await page([table({ collection: "nope" })]);
        expect(missing).not.toContain("<table");
        expect(warnings.some((w) => w.includes('no such collection'))).toBe(true);
    });

    it("draws nothing when the read fails, and the page still renders", async () => {
        failing = "student";
        const out = await page([table({ empty: "No students yet" }), { type: "text", props: { value: "After" } }]);
        expect(out).toContain("After");
        expect(out).not.toContain("Student 1");
        expect(out).not.toContain("<table");
        expect(out).not.toContain("No students yet");
    });
});
