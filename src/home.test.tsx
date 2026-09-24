import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * What a tenant serves at `/` (#44).
 *
 * Every site was a blog at the root: the root route mounted the post index, the blog's three
 * collections could not be replaced, and the header linked to a feed whether the site had one or
 * not. Each of those is the tenant's to say now, and a tenant that says nothing gets what it had.
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

const { defineConfig, hasFeed } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { applySiteSettings, siteConfig } = await import("./site.js");
const { createHome, createHomeMetadata, createPage } = await import("./screens/page.js");
const { createBlogPost } = await import("./screens/blog-post.js");
const { createSiteLayout, createSiteMetadata } = await import("./screens/site-layout.js");
const { createFeed } = await import("./routes/feed.js");
const press = await import("./index.js");

const CMS = "http://cms.test";

const POST = { id: "p1", slug: "first-post", data: { Title: "First post", Slug: "first-post", Body: "A post." } };

/** The school's news, in a type with none of the blueprint's names. */
const ARTICLE = {
    id: "a1",
    slug: "enrolment-open",
    data: {
        Headline: "Enrolment is open",
        Permalink: "enrolment-open",
        Standfirst: "Classes start in June.",
        Story: "The office is open from eight.",
    },
};

const NEWS_COLLECTION = {
    type: "article",
    route: "/news",
    label: "News",
    fields: { title: "Headline", slug: "Permalink", summary: "Standfirst", body: "Story" },
    feed: false,
};

type Tenant = { host: string; settings: Record<string, unknown>; pages?: Record<string, Record<string, unknown>>; content: Record<string, unknown[]> };

const TENANTS: Record<string, Tenant> = {
    // Its home is a page, the way rckoronadal.org's is.
    rotary: {
        host: "rotary.example",
        settings: { Name: "Rotary Club", Url: "https://rotary.example", HomePath: "/home" },
        pages: {
            "/home": {
                id: "h",
                slug: "home",
                data: { Title: "Welcome to the club", Blocks: [{ type: "richText", props: { markdown: "We meet on *Tuesdays*." } }] },
            },
        },
        content: { post: [POST] },
    },
    // Says nothing, so the root is the post index it always was.
    bakery: { host: "bakery.example", settings: { Name: "Corner Bakery", Url: "https://bakery.example" }, content: { post: [POST] } },
    // Replaces the post collection with its own news, and has no feed anywhere.
    school: {
        host: "school.example",
        settings: {
            Name: "Baryo High",
            Url: "https://school.example",
            HomeCollection: "post",
            Collections: { post: NEWS_COLLECTION },
        },
        content: { article: [ARTICLE], post: [] },
    },
    // Names a home page nobody has written yet.
    gap: { host: "gap.example", settings: { Name: "Gap Co", Url: "https://gap.example", HomePath: "/not-written" }, content: { post: [POST] } },
};

let calls: string[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const tenant = new Headers(init?.headers).get("x-tenant");
        calls.push(url.pathname + url.search);

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
        if (url.pathname === "/api/public/pages/navigation") return new Response("", { status: 404 });
        if (url.pathname === "/api/public/pages/resolve") {
            const path = url.searchParams.get("path") ?? "/";
            const entry = t.pages?.[path];
            return entry
                ? Response.json({ contract: 1, path, entry: { contentType: "page", ...entry }, breadcrumbs: [] })
                : new Response("", { status: 404 });
        }
        const [type, slug] = url.pathname.replace(/^\/api\/public\//, "").split("/");
        const entries = t.content[type] as { slug: string }[] | undefined;
        if (!entries) return new Response("", { status: 404 });
        if (slug) {
            const found = entries.find((e) => e.slug === decodeURIComponent(slug));
            return found ? Response.json(found) : new Response("", { status: 404 });
        }
        return paged(entries);
    });
}

const config = defineConfig({ sites: {}, cmsUrl: CMS, pages: "" });

function visit(host: string) {
    requestHeaders = new Headers({ host });
}

async function outcome(run: () => Promise<ReactNode> | ReactNode): Promise<string> {
    try {
        return renderToStaticMarkup(await run());
    } catch (e) {
        return (e as Error).message;
    }
}

async function layoutHtml(host: string): Promise<string> {
    visit(host);
    const Layout = createSiteLayout(config, { loadFonts: false });
    const errors: unknown[] = [];
    const { prelude } = await prerender(await Layout({ children: <p>the page</p> }), { onError: (e) => void errors.push(e) });
    if (errors.length > 0) throw errors[0];
    return new Response(prelude).text();
}

const home = () => outcome(() => createHome(config)({ params: Promise.resolve({}) }));

beforeEach(() => {
    forgetCachedReads();
    requestHeaders = null;
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the home page a tenant picks", () => {
    it("serves the page at HomePath, and the post index to a tenant on the same container that set none", async () => {
        visit("rotary.example");
        const page = await home();
        expect(page).toContain("Welcome to the club");
        expect(page).toContain("We meet on <em>Tuesdays</em>");
        expect(page).not.toContain("First post");
        expect(calls).toContain("/api/public/pages/resolve?path=%2Fhome");

        visit("bakery.example");
        const index = await home();
        expect(index).toContain("First post");
        expect(index).toContain("Corner Bakery");
        expect(index).not.toContain("Welcome to the club");
    });

    it("titles the home page from the page the tenant named", async () => {
        visit("rotary.example");
        expect(await createHomeMetadata(config)({ params: Promise.resolve({}) })).toMatchObject({ title: "Welcome to the club" });
    });

    it("falls back to the index when nothing is served at HomePath, rather than 404ing the front page", async () => {
        visit("gap.example");
        const index = await home();
        expect(index).toContain("First post");
    });

    it("serves the collection index at HomeCollection", async () => {
        visit("school.example");
        const index = await home();
        expect(index).toContain("Enrolment is open");
        expect(index).toContain("Classes start in June.");
        expect(index).toContain('href="/news/enrolment-open"');
    });

    it("reads HomePath and HomeCollection off the settings, and drops a value that is not one", () => {
        const base = { ...config, tenant: "t" };
        expect(applySiteSettings(base, { HomePath: "/home" }, null).home).toEqual({ path: "/home" });
        expect(applySiteSettings(base, { HomeCollection: "news" }, null).home).toEqual({ collection: "news" });
        expect(applySiteSettings(base, { HomePath: "//evil.example", HomeCollection: "not a key" }, null).home).toBeUndefined();
        expect(applySiteSettings(base, {}, null).home).toBeUndefined();
    });
});

describe("a tenant that replaces the blog's collections", () => {
    it("renders its list and its detail pages from the entry it saved", async () => {
        visit("school.example");
        const cfg = await siteConfig(config);
        expect(cfg.collections.post).toMatchObject({ type: "article", route: "/news" });

        visit("school.example");
        const list = await outcome(() => createPage(config)({ params: Promise.resolve({ path: ["news"] }) }));
        expect(list).toContain("Enrolment is open");
        expect(list).toContain('href="/news/enrolment-open"');

        visit("school.example");
        const detail = await outcome(() => createPage(config)({ params: Promise.resolve({ path: ["news", "enrolment-open"] }) }));
        expect(detail).toContain("Enrolment is open");
        expect(detail).toContain("The office is open from eight.");

        // The blog post factory maps through the collection's own fields, not the image's.
        visit("school.example");
        const post = await outcome(() => createBlogPost(config)({ params: Promise.resolve({ slug: "enrolment-open" }) }));
        expect(post).toContain("Enrolment is open");
        expect(post).toContain("The office is open from eight.");
        expect(post).not.toContain("Untitled");

        // A site theme draws its own post page over the same item, and maps it with the engine's
        // own mapping rather than a copy of it.
        visit("school.example");
        const themed = await outcome(() =>
            press.createCollectionDetail(config, press.POST_COLLECTION, {
                related: false,
                view: ({ config: cfg, item }) => <section data-theme="post">{press.PostView({ config: cfg, post: press.postFromItem(cfg, item), related: [] })}</section>,
            })({ params: Promise.resolve({ slug: "enrolment-open" }) }),
        );
        expect(themed).toContain('data-theme="post"');
        expect(themed).toContain("Enrolment is open");
        expect(themed).toContain("The office is open from eight.");

        // Every read went to the type the tenant named, the related band's similarity search
        // included (#78).
        expect(calls.some((c) => c.startsWith("/api/public/article"))).toBe(true);
        expect(calls.filter((c) => /^\/api\/public\/post(\?|\/|$)/.test(c))).toEqual([]);
    });

    it("shows no feed link and no feed alternate when no collection has a feed", async () => {
        const school = await layoutHtml("school.example");
        expect(school).toContain("Baryo High");
        expect(school).not.toContain("/feed.xml");

        visit("school.example");
        expect(await createSiteMetadata(config)()).toMatchObject({ alternates: undefined });
        visit("school.example");
        expect((await createFeed(config)()).status).toBe(404);

        // The bakery's posts still have one, which is every blog that changed nothing.
        const bakery = await layoutHtml("bakery.example");
        expect(bakery).toContain('href="/feed.xml"');
        visit("bakery.example");
        expect(await createSiteMetadata(config)()).toMatchObject({
            alternates: { types: { "application/rss+xml": "https://bakery.example/feed.xml" } },
        });
    });

    it("says whether a site has a feed at all", async () => {
        visit("school.example");
        expect(hasFeed(await siteConfig(config))).toBe(false);
        visit("bakery.example");
        expect(hasFeed(await siteConfig(config))).toBe(true);
    });
});
