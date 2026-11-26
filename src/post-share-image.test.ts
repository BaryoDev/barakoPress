import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { defineConfig } from "./config.js";
import type { Item } from "./collections.js";

const state = vi.hoisted(() => ({
    config: null as unknown,
    item: null as unknown,
    fail: false,
    asked: [] as string[],
}));

vi.mock("./site.js", async (orig) => ({
    ...(await orig<typeof import("./site.js")>()),
    siteConfigOrNull: async () => state.config,
}));
vi.mock("./collections.js", async (orig) => ({
    ...(await orig<typeof import("./collections.js")>()),
    getItem: async (_config: unknown, _key: string, slug: string) => {
        state.asked.push(slug);
        if (state.fail) throw new Error("cms down");
        return state.item;
    },
}));

const { createPostShareImage } = await import("./routes/post-share-image.js");
const { SHARE_IMAGE_SIZE } = await import("./routes/share-image.js");
const { generatedPostShareImages, isPostSlug, postShareImageHref, MAX_POST_SLUG } = await import("./post-share-image.js");
const { itemMetadata } = await import("./screens/collection.js");

// A font that ships with Next, so the test needs no file of its own.
const FONT = join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf");
const before = process.env.PRESS_SHARE_IMAGE_FONT;

const config = defineConfig({ site: { name: "Test Site", url: "https://t.example" }, cmsUrl: "https://cms.example" });

function post(over: Partial<Item> = {}): Item {
    return {
        id: "1",
        collection: "post",
        slug: "hello-world",
        title: "Hello world",
        body: "",
        featured: false,
        tags: [],
        refs: {},
        content: { updatedAt: "2026-11-19T10:00:00Z" },
        ...over,
    } as unknown as Item;
}

const ask = (slug: string, url = `https://t.example/_share/post-image/${encodeURIComponent(slug)}`, cfg: unknown = config) => {
    state.config = cfg;
    return createPostShareImage(cfg as typeof config)(new Request(url), { params: Promise.resolve({ slug }) });
};

function pngSize(buf: Buffer) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

beforeEach(() => {
    process.env.PRESS_SHARE_IMAGE_FONT = FONT;
    state.item = post();
    state.fail = false;
    state.asked = [];
});
afterEach(() => {
    if (before === undefined) delete process.env.PRESS_SHARE_IMAGE_FONT;
    else process.env.PRESS_SHARE_IMAGE_FONT = before;
});

describe("the post share image route", () => {
    it("answers 200 image/png at the configured size", async () => {
        const res = await ask("hello-world");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual(SHARE_IMAGE_SIZE);
        expect(state.asked).toEqual(["hello-world"]);
    });

    it("revalidates rather than caching for a year, and sends no Vary for a host-routed site", async () => {
        const res = await ask("hello-world");
        const cc = res.headers.get("cache-control") ?? "";
        expect(cc).toBe("public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
        expect(cc).not.toContain("immutable");
        expect(res.headers.get("vary")).toBeNull();
    });

    it("varies on the header that picks the tenant", async () => {
        const tenant = defineConfig({
            site: { name: "T", url: "https://t.example" },
            cmsUrl: "https://cms.example",
            sites: { tenantHeader: "X-Press-Tenant" },
        });
        const res = await ask("hello-world", undefined, tenant);
        expect(res.status).toBe(200);
        expect(res.headers.get("vary")).toBe("x-press-tenant");
    });

    it("draws a post that has a category", async () => {
        state.item = post({ refs: { Category: { slug: "news", name: "News" } } as never });
        expect((await ask("hello-world")).status).toBe(200);
    });

    it("answers 404 for a slug no published post holds", async () => {
        state.item = null;
        const res = await ask("no-such-post");
        expect(res.status).toBe(404);
        expect(res.headers.get("content-type")).not.toBe("image/png");
    });

    it("answers 404 for a post with no title", async () => {
        state.item = post({ title: "   " });
        expect((await ask("hello-world")).status).toBe(404);
    });

    it("answers 404 while no font is configured, and for a held site", async () => {
        delete process.env.PRESS_SHARE_IMAGE_FONT;
        expect((await ask("hello-world")).status).toBe(404);
        process.env.PRESS_SHARE_IMAGE_FONT = FONT;
        expect((await ask("hello-world", undefined, { ...config, holding: true })).status).toBe(404);
    });

    it("answers 502 with no-store when the CMS fails, so an outage is not cached", async () => {
        state.fail = true;
        const res = await ask("hello-world");
        expect(res.status).toBe(502);
        expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("answers 404 with no-store", async () => {
        state.item = null;
        expect((await ask("no-such-post")).headers.get("cache-control")).toBe("no-store");
    });

    it("answers 404, not a thrown error, when the font file is garbage", async () => {
        const dir = mkdtempSync(join(tmpdir(), "press-bad-font-"));
        const bad = join(dir, "bad.ttf");
        writeFileSync(bad, "this is not a font");
        process.env.PRESS_SHARE_IMAGE_FONT = bad;
        try {
            const res = await ask("hello-world");
            expect(res.status).toBe(404);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("answers 404 for a noIndex post", async () => {
        state.item = post({ seo: { noIndex: true } as never });
        expect((await ask("hello-world")).status).toBe(404);
    });

    it("never looks up a hostile slug", async () => {
        const hostile = [
            "../../etc/passwd",
            "a/b",
            "a\\b",
            "..",
            ".hidden",
            "x y",
            "a\r\nSet-Cookie: x=1",
            "<script>alert(1)</script>",
            "a\u0000b",
            "a?b=c",
            "a#b",
            "%2e%2e",
            "a".repeat(MAX_POST_SLUG + 1),
            "",
        ];
        for (const slug of hostile) expect((await ask(slug)).status, JSON.stringify(slug)).toBe(404);
        expect(state.asked).toEqual([]);
    });

    it("ignores the query, so no caller text reaches the card", async () => {
        const res = await ask("hello-world", "https://t.example/_share/post-image/hello-world?title=Evil&path=%2Fx&v=%00");
        expect(res.status).toBe(200);
        expect(state.asked).toEqual(["hello-world"]);
    });
});

describe("isPostSlug", () => {
    it("takes the slugs a post holds", () => {
        for (const ok of ["hello", "hello-world", "v1.2_release", "kape-ana-2", "pagkain"]) expect(isPostSlug(ok)).toBe(true);
        expect(isPostSlug(undefined)).toBe(false);
        expect(isPostSlug(5)).toBe(false);
    });

    it("takes a slug written with combining marks, and still refuses a leading mark, dot or dash", () => {
        expect(isPostSlug("cafe\u0301")).toBe(true);
        expect(isPostSlug("cafe\u0301-au-lait")).toBe(true);
        for (const bad of ["\u0301abc", ".a", "-a", "_a", "a/b", ""]) expect(isPostSlug(bad), JSON.stringify(bad)).toBe(false);
    });
});

describe("the post page's tags", () => {
    it("names the post image in og:image and twitter:image, with the updated time as the version", () => {
        const meta = itemMetadata(post(), config);
        const url = "https://t.example/_share/post-image/hello-world?v=2026-11-19T10%3A00%3A00Z";
        expect(meta.openGraph?.images).toEqual([url]);
        expect(meta.twitter?.images).toEqual([url]);
        expect((meta.twitter as { card?: string }).card).toBe("summary_large_image");
    });

    it("changes the address when the post is edited", () => {
        const a = generatedPostShareImages(config, post());
        const b = generatedPostShareImages(config, post({ content: { updatedAt: "2026-11-20T08:00:00Z" } as never }));
        expect(a).not.toEqual(b);
    });

    it("falls back to the site card when the post has no title", () => {
        const meta = itemMetadata(post({ title: "" }), config);
        expect(meta.openGraph?.images).toBeUndefined();
        expect(meta.twitter?.images).toBeUndefined();
    });

    it("falls back to the site card with no font, no site URL, or no config", () => {
        delete process.env.PRESS_SHARE_IMAGE_FONT;
        expect(itemMetadata(post(), config).openGraph?.images).toBeUndefined();
        process.env.PRESS_SHARE_IMAGE_FONT = FONT;
        const bare = { ...config, site: { ...config.site, url: "" } };
        expect(itemMetadata(post(), bare).openGraph?.images).toBeUndefined();
        expect(itemMetadata(post()).openGraph?.images).toBeUndefined();
    });

    it("keeps an image the post's SEO fields name", () => {
        const meta = itemMetadata(post({ seo: { imageUrl: "https://cdn.example/own.png" } as never }), config);
        expect(meta.openGraph?.images).toEqual(["https://cdn.example/own.png"]);
    });

    it("keeps the post's cover over the drawn card when the SEO fields name no image", () => {
        const meta = itemMetadata(post({ image: "https://cdn.example/cover.png" } as never), config);
        expect(meta.openGraph?.images).toEqual(["https://cdn.example/cover.png"]);
        expect(meta.twitter?.images).toEqual(["https://cdn.example/cover.png"]);
    });

    it("advertises no card for a noIndex post", () => {
        const meta = itemMetadata(post({ seo: { noIndex: true } as never }), config);
        expect(meta.openGraph?.images).toBeUndefined();
        expect(generatedPostShareImages(config, post({ seo: { noIndex: true } as never }))).toBeUndefined();
    });

    it("draws nothing for another collection's entry", () => {
        expect(itemMetadata(post({ collection: "doctors" }), config).openGraph?.images).toBeUndefined();
    });

    it("advertises nothing when the site is holding", () => {
        expect(generatedPostShareImages({ ...config, holding: true } as never, post())).toBeUndefined();
    });

    it("advertises nothing for a slug the route would refuse", () => {
        expect(generatedPostShareImages(config, post({ slug: "a/b" }))).toBeUndefined();
    });
});

describe("postShareImageHref", () => {
    it("encodes the slug and the version, and has no dot in its path", () => {
        const href = postShareImageHref("https://t.example", "a b&c", "x&y=z #1");
        expect(href).toBe("https://t.example/_share/post-image/a%20b%26c?v=x%26y%3Dz+%231");
        expect(new URL(href).pathname.split("/").pop()).not.toContain(".");
    });

    it("leaves off a version that is not short", () => {
        expect(postShareImageHref("https://t.example", "p", "v".repeat(100))).toBe("https://t.example/_share/post-image/p");
        expect(postShareImageHref("https://t.example", "p")).toBe("https://t.example/_share/post-image/p");
    });
});
