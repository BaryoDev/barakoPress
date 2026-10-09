import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Field roles and the route template, from `GET /api/public/types/{type}/description` (barakoCMS
 * 4.7, #1108; barakoPress #192).
 *
 * The collection's field map names fields this type does not have, the way a site configured for the
 * blueprint and pointed at a school's events would. Only the description says where the title is.
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
            fields: { title: "Title", summary: "Summary", date: "Date", image: "Image" },
        },
    },
});

const ENTRIES = [
    {
        id: "e1",
        slug: "sports-day",
        data: {
            EventName: "Sports day",
            Teaser: "Races on the field",
            StartsOn: "2026-11-02T08:00:00Z",
            Poster: "https://cdn.example/sports.jpg",
        },
    },
    // The role field is empty here, so the configured name is read after it.
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
    it("reads the title, summary, date and image from the fields holding the roles", async () => {
        const item = await getItem(config, "events", "sports-day");
        expect(item).toMatchObject({
            title: "Sports day",
            summary: "Races on the field",
            date: "2026-11-02T08:00:00Z",
            image: "https://cdn.example/sports.jpg",
        });
    });

    it("falls back to the configured names when an entry leaves the role field empty", async () => {
        const { items } = await listCollection(config, "events");
        expect(items.map((i) => i.title)).toEqual(["Sports day", "Open day"]);
        expect(items[1].summary).toBe("Come and see");
    });

    it("draws the role fields on the item page and in the feed", async () => {
        const page = createCollectionDetail(config, "events");
        const html = renderToStaticMarkup(await page({ params: Promise.resolve({ slug: "sports-day" }) }));
        expect(html).toContain("<h1>Sports day</h1>");
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
        expect(item?.title).toBe("Untitled");
        expect(item?.summary).toBeUndefined();
        expect(item?.date).toBeUndefined();

        const { items } = await listCollection(config, "events");
        expect(items.map((i) => i.title)).toEqual(["Untitled", "Open day"]);
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
