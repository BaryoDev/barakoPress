import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Field roles and the route template, from `GET /api/public/types/{type}/description` (barakoCMS
 * 4.7, #1108; barakoPress #192).
 *
 * The events collection names its title and nothing else, so the description is what says where the
 * summary, the date and the image are. A role never replaces a name the site wrote itself.
 */
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { defineConfig } = await import("./config.js");
const { describeType, forgetCachedReads } = await import("./delivery.js");
const { forgetCollectionWarnings, getItem, listCollection } = await import("./collections.js");
const { createCollectionDetail } = await import("./screens/collection.js");
const { createFeed } = await import("./routes/feed.js");
const { createSitemap, forgetSitemapWarnings } = await import("./routes/sitemap.js");

const CMS = "http://cms.test";

const config = defineConfig({
    site: { name: "Riverside School", url: "https://riverside.example" },
    cmsUrl: CMS,
    collections: {
        events: {
            type: "event",
            route: "/whats-on",
            feed: true,
            fields: { title: "Title" },
        },
    },
});

const ENTRIES = [
    {
        id: "e1",
        slug: "sports-day",
        data: {
            Title: "Sports day",
            EventName: "Sports day, the role field",
            Teaser: "Races on the field",
            StartsOn: "2026-11-02T08:00:00Z",
            Poster: "https://cdn.example/sports.jpg",
        },
    },
    { id: "e2", slug: "open-day", data: { EventName: "", Title: "Open day", Teaser: "Come and see" } },
];

const DESCRIPTION = {
    name: "event",
    routeTemplate: "/whats-on/{slug}",
    fields: [
        { name: "EventName", type: "string", role: "title", editor: null },
        { name: "Teaser", type: "text", role: "summary", editor: null },
        { name: "StartsOn", type: "datetime", role: "date", editor: null },
        { name: "Poster", type: "url", role: "image", editor: "image" },
        { name: "Slug", type: "slug", role: null, editor: null },
    ],
};

/** What the description route answers: a body, or a status for an API without the route. */
let description: unknown | number = DESCRIPTION;
let calls: { path: string; tags: string[] }[] = [];

function cms() {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit & { next?: { tags?: string[] } }) => {
        const url = new URL(String(input));
        calls.push({ path: url.pathname, tags: init?.next?.tags ?? [] });
        if (url.pathname === "/api/public/types/event/description") {
            return typeof description === "number" ? new Response("", { status: description }) : Response.json(description);
        }
        if (url.pathname === "/api/public/event") {
            return Response.json({ items: ENTRIES, page: 1, pageSize: 20, totalItems: 2, totalPages: 1, hasNextPage: false });
        }
        const one = ENTRIES.find((e) => url.pathname === `/api/public/event/${e.slug}`);
        return one ? Response.json(one) : new Response("", { status: 404 });
    });
}

const descriptionReads = () => calls.filter((c) => c.path === "/api/public/types/event/description");

beforeEach(() => {
    forgetCachedReads();
    forgetCollectionWarnings();
    forgetSitemapWarnings();
    description = DESCRIPTION;
    calls = [];
    vi.stubGlobal("fetch", cms());
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("field roles from the type description", () => {
    it("fills the summary, date and image the collection left unset from the fields holding the roles", async () => {
        const item = await getItem(config, "events", "sports-day");
        expect(item).toMatchObject({
            title: "Sports day",
            summary: "Races on the field",
            date: "2026-11-02T08:00:00Z",
            image: "https://cdn.example/sports.jpg",
        });
    });

    it("keeps the title the site named over the field holding the title role", async () => {
        const { items } = await listCollection(config, "events");
        expect(items.map((i) => i.title)).toEqual(["Sports day", "Open day"]);
        expect(items[1].summary).toBe("Come and see");
    });

    it("keeps a blog site's own field name over the role, and reads the role ahead of a default", async () => {
        const blog = (fields?: { title: string }) =>
            defineConfig({ site: { name: "News", url: "https://news.example" }, cmsUrl: CMS, types: { post: "event" }, ...(fields ? { fields } : {}) });
        description = { ...DESCRIPTION, fields: [{ name: "Title", type: "string", role: "title" }] };
        const entry = { id: "n", slug: "sports-day", data: { Headline: "The headline", Title: "The title" } };
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const url = new URL(String(input));
                if (url.pathname === "/api/public/types/event/description") return Response.json(description);
                return url.pathname === "/api/public/event/sports-day" ? Response.json(entry) : new Response("", { status: 404 });
            }),
        );

        // The site said Headline, so Headline it is, whatever the type's role says.
        expect((await getItem(blog({ title: "Headline" }), "post", "sports-day"))?.title).toBe("The headline");

        // Left to the blueprint's Title, the role field is read ahead of it.
        description = { ...DESCRIPTION, fields: [{ name: "Headline", type: "string", role: "title" }] };
        forgetCachedReads();
        expect((await getItem(blog(), "post", "sports-day"))?.title).toBe("The headline");
        entry.data.Headline = "";
        forgetCachedReads();
        expect((await getItem(blog(), "post", "sports-day"))?.title).toBe("The title");
    });

    it("draws the role fields on the item page and in the feed", async () => {
        const page = createCollectionDetail(config, "events");
        const html = renderToStaticMarkup(await page({ params: Promise.resolve({ slug: "sports-day" }) }));
        expect(html).toContain("<h1>Sports day</h1>");
        expect(html).not.toContain("the role field");
        expect(html).toContain("Races on the field");

        const feed = await (await createFeed(config, "events")()).text();
        expect(feed).toContain("<title>Sports day</title>");
        expect(feed).toContain("<description>Races on the field</description>");
        expect(feed).toContain(`<pubDate>${new Date("2026-11-02T08:00:00Z").toUTCString()}</pubDate>`);
        expect(feed).toContain("<link>https://riverside.example/whats-on/sports-day</link>");
    });

    it("is read as a delivery read: tagged with its type, so a purge of the type drops it", async () => {
        await getItem(config, "events", "sports-day");
        const reads = descriptionReads();
        expect(reads).toHaveLength(1);
        expect(reads[0].tags).toEqual(["cms", "cms:type:event"]);
    });

    it("leaves out a role on a field name that is not a plain identifier, and a template that breaks the rule", async () => {
        description = {
            routeTemplate: "//elsewhere.example/{slug}",
            fields: [
                { name: "__proto__.x", role: "title" },
                { name: "Teaser", role: "SUMMARY" },
                { name: "Other", role: "summary" },
            ],
        };
        const found = await describeType(config, "event");
        expect(found).toEqual({ routeTemplate: null, roles: { summary: "Teaser" } });
    });
});

describe("an API without the description route", () => {
    it("reads by the field map exactly as before, and asks for the description once", async () => {
        description = 404;
        const item = await getItem(config, "events", "sports-day");
        expect(item?.title).toBe("Sports day");
        expect(item?.summary).toBeUndefined();
        expect(item?.date).toBeUndefined();
        expect(item?.image).toBeUndefined();

        const { items } = await listCollection(config, "events");
        expect(items.map((i) => i.title)).toEqual(["Sports day", "Open day"]);
        await getItem(config, "events", "open-day");
        expect(descriptionReads()).toHaveLength(1);
    });

    it("renders by the field map when the description read fails", async () => {
        description = 500;
        const item = await getItem(config, "events", "open-day");
        expect(item?.title).toBe("Open day");
    });
});

describe("the route template", () => {
    it("says nothing when it names the route this site serves", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await listCollection(config, "events");
        expect(warn).not.toHaveBeenCalled();
    });

    it("keeps links on the served route when it names another path, and says so once", async () => {
        description = { ...DESCRIPTION, routeTemplate: "/events/{slug}" };
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const sitemap = await createSitemap(config)();
        const feed = await (await createFeed(config, "events")()).text();

        const urls = sitemap.map((e) => e.url);
        expect(urls).toContain("https://riverside.example/whats-on/sports-day");
        expect(urls.some((u) => u.includes("/events/"))).toBe(false);
        expect(feed).toContain("<link>https://riverside.example/whats-on/sports-day</link>");
        const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("/events/{slug}"));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain("/whats-on/{slug}");
    });
});
