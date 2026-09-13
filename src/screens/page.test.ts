import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../config.js";
import { createPageStaticParams } from "./page.js";
import { createPostStaticParams } from "./blog-post.js";

const config = defineConfig({ site: { name: "T", url: "https://t.example" } });

/* A CMS holding `total` entries, one per page, so the old 200 page cap would cut it short. */
function cmsWith(total: number) {
    return vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page"));
        const items =
            page <= total ? [{ id: String(page), slug: `s${page}`, data: { Title: "x", Slug: `s${page}` } }] : [];
        return new Response(
            JSON.stringify({ items, page, pageSize: 1, totalItems: total, totalPages: total, hasNextPage: page < total }),
        );
    });
}

afterEach(() => vi.unstubAllGlobals());

describe("static params", () => {
    it("lists every page, past 200 pages of results", async () => {
        vi.stubGlobal("fetch", cmsWith(250));
        const slugs = await createPageStaticParams(config)();

        expect(slugs).toHaveLength(250);
        expect(slugs.at(-1)).toEqual({ slug: "s250" });
    });

    it("lists every post, past 200 pages of results", async () => {
        vi.stubGlobal("fetch", cmsWith(250));
        const slugs = await createPostStaticParams(config)();

        expect(slugs).toHaveLength(250);
    });

    it("stops on an empty page even if the API claims there is another", async () => {
        const fetch = vi.fn(async () =>
            new Response(JSON.stringify({ items: [], page: 1, pageSize: 100, totalItems: 0, totalPages: 0, hasNextPage: true })),
        );
        vi.stubGlobal("fetch", fetch);

        expect(await createPageStaticParams(config)()).toEqual([]);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
