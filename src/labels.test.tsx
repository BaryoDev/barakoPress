import { readFileSync, readdirSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Visitor text from the tenant's `Labels` map (#47).
 *
 * A school in Koronadal setting `Locale` to `fil-PH` used to get Filipino dates beside English
 * "min read" and "Related". The words are a setting now, and the second test here is what keeps
 * them one: it reads the screens and fails on a default that is still written into the markup.
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
        throw Object.assign(new Error(`NEXT_REDIRECT 307 ${to}`), { digest: "NEXT_REDIRECT" });
    },
    permanentRedirect: (to: string) => {
        throw Object.assign(new Error(`NEXT_REDIRECT 308 ${to}`), { digest: "NEXT_REDIRECT" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig, DEFAULT_LABELS, LABEL_KEYS } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { applySiteSettings } = await import("./site.js");
const { createBlogIndex, createBlogPost, ItemView } = await import("./index.js");

const CMS = "http://cms.test";

const POST = {
    id: "p1",
    slug: "pasko",
    data: {
        Title: "Pasko sa Koronadal",
        Slug: "pasko",
        Excerpt: "Ang unang araw.",
        Body: "Isang talata na sapat ang haba para sa isang minuto ng pagbasa.",
        PublishedAt: "2026-03-04T12:00:00Z",
        Featured: true,
        Author: { id: "a1", slug: "juan", data: { Name: "Juan Dela Cruz", Slug: "juan" } },
    },
};

const TENANTS: Record<string, { host: string; settings: Record<string, unknown>; posts: unknown[] }> = {
    school: {
        host: "school.example",
        settings: {
            Name: "Baryo High",
            Url: "https://school.example",
            Locale: "fil-PH",
            Labels: {
                minRead: "minutong pagbasa",
                by: "ni",
                featured: "Itinampok",
                back: "Bumalik",
                empty: "Wala pang nailathala.",
                // Not a string, so the English stands rather than a blank where a word belongs.
                emptyNote: 42,
            },
        },
        posts: [POST],
    },
    // Sets no labels, so every word is the English it always was.
    bakery: { host: "bakery.example", settings: { Name: "Corner Bakery", Url: "https://bakery.example" }, posts: [POST] },
    quiet: { host: "quiet.example", settings: { Name: "Quiet Co", Url: "https://quiet.example", Labels: { empty: "Malapit na." } }, posts: [] },
};

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");

        const byHost = url.pathname.match(/^\/api\/tenants\/by-host\/(.+)$/);
        if (byHost) {
            const entry = Object.entries(TENANTS).find(([, t]) => t.host === decodeURIComponent(byHost[1]));
            return entry ? Response.json({ handle: entry[0] }) : new Response("", { status: 404 });
        }
        const t = tenant ? TENANTS[tenant] : undefined;
        if (!t) return new Response("", { status: 404 });
        const paged = (items: unknown[]) =>
            Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
        if (url.pathname === "/api/public/site") return paged([{ id: "s", data: t.settings }]);
        if (url.pathname === "/api/public/post") return paged(t.posts);
        if (url.pathname === "/api/public/post/pasko") return t.posts.length > 0 ? Response.json(POST) : new Response("", { status: 404 });
        return new Response("", { status: 404 });
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS });

async function outcome(run: () => Promise<ReactNode> | ReactNode): Promise<string> {
    try {
        return renderToStaticMarkup(await run());
    } catch (e) {
        return (e as Error).message;
    }
}

function visit(host: string) {
    requestHeaders = new Headers({ host });
}

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("visitor text from the tenant's labels", () => {
    it("prints the tenant's words on a post, and English for the tenant that set none", async () => {
        visit("school.example");
        const post = await outcome(() => createBlogPost(config)({ params: Promise.resolve({ slug: "pasko" }) }));
        expect(post).toContain("Pasko sa Koronadal");
        expect(post).toContain("minutong pagbasa");
        expect(post).toContain("ni <a href=\"/authors/juan\"");
        expect(post).not.toContain("min read");

        visit("bakery.example");
        const english = await outcome(() => createBlogPost(config)({ params: Promise.resolve({ slug: "pasko" }) }));
        expect(english).toContain("min read");
        expect(english).toContain("by <a href=\"/authors/juan\"");
    });

    it("prints the tenant's word on the back link of an item page", () => {
        const cfg = applySiteSettings({ ...config, tenant: "school" }, TENANTS.school.settings, null);
        const item = {
            id: "i1",
            collection: "post",
            slug: "pasko",
            title: "Pasko sa Koronadal",
            body: "",
            featured: false,
            tags: [],
            refs: {},
            content: { id: "i1", slug: "pasko", data: {} },
        };
        const html = renderToStaticMarkup(ItemView({ config: cfg, item }));
        expect(html).toContain("Bumalik");
        expect(html).not.toContain(">Back<");
    });

    it("prints the tenant's words on an index, and keeps the English for a key it did not set", async () => {
        visit("school.example");
        const index = await outcome(() => createBlogIndex(config)());
        expect(index).toContain("Itinampok");
        expect(index).not.toContain("Featured");

        visit("quiet.example");
        const empty = await outcome(() => createBlogIndex(config)());
        expect(empty).toContain("Malapit na.");
        expect(empty).toContain(DEFAULT_LABELS.emptyNote);
    });

    it("merges Labels one key at a time, and drops a value that is not a word", () => {
        const out = applySiteSettings({ ...config, tenant: "t" }, TENANTS.school.settings, null).labels;
        expect(out.minRead).toBe("minutong pagbasa");
        expect(out.emptyNote).toBe(DEFAULT_LABELS.emptyNote);
        expect(out.related).toBe(DEFAULT_LABELS.related);

        const blank = applySiteSettings(
            { ...config, tenant: "t" },
            { Labels: { back: "   ", feed: "x".repeat(500), related: "Kaugnay" } },
            null,
        ).labels;
        expect(blank.back).toBe(DEFAULT_LABELS.back);
        expect(blank.feed).toBe(DEFAULT_LABELS.feed);
        expect(blank.related).toBe("Kaugnay");

        // A build-time site says the same thing in its config file.
        const built = defineConfig({ site: { name: "B", url: "https://b.example" }, labels: { untitled: "Walang pamagat" } });
        expect(built.labels.untitled).toBe("Walang pamagat");
        expect(built.labels.minRead).toBe(DEFAULT_LABELS.minRead);
    });

    it("leaves no label's English written into a screen", () => {
        const files = [
            ...readdirSync("src/screens")
                .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
                .map((f) => `src/screens/${f}`),
            "src/collections.ts",
            "src/cms.ts",
        ];
        expect(files.length).toBeGreaterThan(5);
        expect(LABEL_KEYS.length).toBe(Object.keys(DEFAULT_LABELS).length);

        // Comments are prose about the screen, not copy the visitor reads, so they are not scanned.
        // A hit preceded by a dot or a brace is the label being read, `config.labels.by`.
        const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        const found: string[] = [];
        for (const file of files) {
            const source = withoutComments(readFileSync(file, "utf8"));
            for (const key of LABEL_KEYS) {
                const word = DEFAULT_LABELS[key].split(".")[0];
                const pattern = new RegExp(`(^|[^A-Za-z.{])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z])`);
                if (pattern.test(source)) found.push(`${file}: ${key}`);
            }
        }
        expect(found).toEqual([]);
    });
});
