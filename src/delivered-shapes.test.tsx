import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * What barakoCMS 4.6 delivers that it did not before, read through the collection path and drawn:
 *
 *   a file field          { id, url, fileName, contentType, size, alt, caption }, absent when private (#1099)
 *   an inline image       { url: "data:image/...;base64,...", alt } (#1105)
 *   a list of references  ids, or whole entries with `include` (#1104)
 *   a null slug           a type whose slug field is not Public has none (#1100)
 *
 * Each is also what an older API never sends, so every case here is one an older API cannot reach.
 */

vi.mock("next/headers", () => ({
    headers: async () => {
        throw new Error("headers() was read");
    },
    cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
    notFound: () => {
        throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
}));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("./config.js");
const { forgetCachedReads } = await import("./delivery.js");
const { toItem } = await import("./collections.js");
const { toPage } = await import("./cms.js");
const { Card, ItemView, itemMetadata } = await import("./screens/collection.js");
const { itemScope } = await import("./blocks/bind.js");
const { readProps } = await import("./blocks/schema.js");
const { createBlockRegistry } = await import("./blocks/registry.js");
const { Asset } = await import("./assets.js");
const { createSitemap } = await import("./routes/sitemap.js");
const { createFeed } = await import("./routes/feed.js");
import type { PublicContent } from "./delivery.js";
import type { BlockField } from "./blocks/schema.js";

const CMS = "http://cms.test";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const COVER = {
    id: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    url: "https://files.example/harbour.png",
    fileName: "harbour.png",
    contentType: "image/png",
    size: 48213,
    alt: "Boats at dawn",
    caption: null,
};
const MENU = { ...COVER, url: "/api/public/files/menu", fileName: "menu.pdf", contentType: "application/pdf", alt: null };
const ANA = { id: "s1", slug: "ana", data: { Name: "Ana", Slug: "ana" } };
const BEN = { id: "s2", slug: "ben", data: { Name: "Ben", Slug: "ben" } };

const config = defineConfig({
    site: { name: "Test", url: "https://test.example" },
    cmsUrl: CMS,
    collections: {
        event: {
            type: "event",
            route: "/events",
            fields: { title: "EventName", slug: "Slug", image: "Cover", imageAlt: "CoverAlt", url: "Menu", photo: "Logo" },
            references: { Speakers: { collection: "speaker" } },
        },
        speaker: { type: "speaker", route: "/speakers", fields: { title: "Name", slug: "Slug" } },
    },
});

const entry = (data: Record<string, unknown>, extra: Partial<PublicContent> = {}): PublicContent => ({
    id: "e1",
    slug: "harbour-night",
    contentType: "event",
    data: { EventName: "Harbour night", ...data },
    ...extra,
});

beforeEach(() => forgetCachedReads());
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("a file field", () => {
    it("draws an image file as the item's image, with the alt written on the file", () => {
        const item = toItem(config, "event", entry({ Cover: COVER }));

        expect(item.image).toBe(COVER.url);
        expect(item.imageAlt).toBe("Boats at dawn");
        const html = renderToStaticMarkup(<ItemView config={config} item={item} />);
        expect(html).toContain(`src="${COVER.url}" alt="Boats at dawn"`);
    });

    it("prefers the entry's own alt field over the file's", () => {
        const item = toItem(config, "event", entry({ Cover: COVER, CoverAlt: "The harbour" }));

        expect(item.imageAlt).toBe("The harbour");
    });

    it("draws no image when delivery left a private file out", () => {
        const item = toItem(config, "event", entry({}));

        expect(item.image).toBeUndefined();
        expect(renderToStaticMarkup(<ItemView config={config} item={item} />)).not.toContain("<img");
    });

    it("links a file that is not an image, by its name", () => {
        const item = toItem(config, "event", entry({ Menu: MENU }));

        expect(item.url).toBe("/api/public/files/menu");
        expect(item.urlLabel).toBe("menu.pdf");
        expect(renderToStaticMarkup(<ItemView config={config} item={item} />)).toContain(
            `<a href="/api/public/files/menu" rel="noopener noreferrer">menu.pdf</a>`,
        );
    });

    it("is not drawn as an image when it is not one", () => {
        expect(toItem(config, "event", entry({ Cover: MENU })).image).toBeUndefined();
    });
});

describe("an inline image", () => {
    it("draws an inline image with its alt", () => {
        const item = toItem(config, "event", entry({ Cover: { url: PNG, alt: "Acme logo" } }));

        expect(item.image).toBe(PNG);
        expect(renderToStaticMarkup(<ItemView config={config} item={item} />)).toContain(`src="${PNG}" alt="Acme logo"`);
    });

    it("reads a photo role from one too", () => {
        expect(toItem(config, "event", entry({ Logo: { url: PNG, alt: null } })).photo).toBe(PNG);
    });

    it("never puts one in a share card, which a crawler fetches by address", () => {
        const item = toItem(config, "event", entry({ Cover: { url: PNG, alt: "x" } }));

        expect(itemMetadata(item).openGraph?.images).toBeUndefined();
    });

    it("is taken by an image block's src, and a data URI of another type is not", () => {
        const fields = createBlockRegistry(config).get("image")!.fields as BlockField[];

        expect(readProps(fields, { src: PNG })).not.toBeNull();
        expect(readProps(fields, { src: "data:text/html;base64,PGI+" })).toBeNull();
    });
});

describe("an image src", () => {
    it("draws nothing for a src that is not http, https, a site path or an allowed inline image", () => {
        const html = renderToStaticMarkup(<Asset src="javascript:alert(1)" alt="x" theme={config.theme} />);

        expect(html).toBe("");
    });
});

describe("a list of references", () => {
    it("links every speaker the entry lists, in order, when they came back resolved", () => {
        const item = toItem(config, "event", entry({ Speakers: [ANA, BEN] }));

        expect(item.refLists?.Speakers.map((r) => r.slug)).toEqual(["ana", "ben"]);
        expect(item.refs.Speakers?.slug).toBe("ana");
        const html = renderToStaticMarkup(<Card config={config} item={item} />);
        expect(html).toContain(`<a href="/speakers/ana">Ana</a>`);
        expect(html).toContain(`<a href="/speakers/ben">Ben</a>`);
    });

    it("reads as the whole list in a binding", () => {
        const item = toItem(config, "event", entry({ Speakers: [ANA, BEN] }));
        const listed = itemScope(config, item).Speakers as { name: string }[];

        expect(listed).toHaveLength(2);
        expect(listed.map((r) => r.name)).toEqual(["Ana", "Ben"]);
    });

    it("shows nothing for ids that were not included", () => {
        const item = toItem(config, "event", entry({ Speakers: ["s1", "s2"] }));

        expect(item.refLists?.Speakers).toEqual([]);
        expect(item.refs.Speakers).toBeUndefined();
    });
});

describe("an entry with no slug", () => {
    it("has none, rather than one read from a field the API would answer 404 for", () => {
        const item = toItem(config, "event", entry({ Slug: "from-the-field" }, { slug: null }));

        expect(item.slug).toBe("");
    });

    it("still reads the field when an older API leaves the member out", () => {
        const item = toItem(config, "event", entry({ Slug: "from-the-field" }, { slug: undefined }));

        expect(item.slug).toBe("from-the-field");
    });

    it("draws a card with a title and no link", () => {
        const item = toItem(config, "event", entry({}, { slug: null }));
        const html = renderToStaticMarkup(<Card config={config} item={item} />);

        expect(html).toContain("<h2>Harbour night</h2>");
        expect(html).not.toContain(`href="/events/"`);
    });

    it("gives a page none either", () => {
        expect(toPage(config, { id: "p1", slug: null, data: { Title: "About", Slug: "about" } }).slug).toBe("");
    });
});

describe("a title held under a role", () => {
    it("falls back to the API's SEO title before Untitled", () => {
        const item = toItem(config, "event", { id: "e2", slug: "x", data: { Headline: "Open day" }, seo: { title: "Open day" } });

        expect(item.title).toBe("Open day");
    });

    it("is Untitled when the API says nothing either", () => {
        expect(toItem(config, "event", { id: "e3", slug: "x", data: {} }).title).toBe("Untitled");
    });
});

describe("the sitemap and the feed with an entry that has no slug", () => {
    const blog = defineConfig({ site: { name: "Test", url: "https://test.example" }, cmsUrl: CMS });
    const posts = [
        { id: "a", slug: "hello", data: { Title: "Hello", Slug: "hello" } },
        { id: "b", slug: null, data: { Title: "No slug" } },
    ];

    beforeEach(() => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request) => {
                const path = new URL(String(input)).pathname;
                const items = path === "/api/public/post" ? posts : [];
                return Response.json({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, hasNextPage: false });
            }),
        );
    });

    it("lists the entry with a slug and leaves the other out of the sitemap", async () => {
        const urls = (await createSitemap(blog)()).map((u) => u.url);

        expect(urls).toContain("https://test.example/blog/hello");
        expect(urls).not.toContain("https://test.example/blog/");
    });

    it("leaves it out of the feed", async () => {
        const xml = await (await createFeed(blog)()).text();

        expect(xml).toContain("<title>Hello</title>");
        expect(xml).not.toContain("No slug");
    });
});
