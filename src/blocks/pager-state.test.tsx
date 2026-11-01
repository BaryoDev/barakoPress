import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defineConfig } from "../config.js";
import { PAGER_BLOCK, dataBlocks, readPagerState, writePagerState } from "./data.js";

/*
 * The paging state a pager carries in one string field, and the links drawn from it. The state is
 * written by the binder and read back at render, so what matters is that it survives the trip.
 */

const config = defineConfig({ site: { name: "Test", url: "https://test.example" } });

async function draw(state: string | undefined) {
    const block = dataBlocks(config).find((b) => b.type === PAGER_BLOCK);
    expect(block).toBeDefined();
    const node = await block!.component({ props: { state }, slots: {}, theme: config.theme } as never);
    return renderToStaticMarkup(<>{node}</>);
}

describe("writePagerState and readPagerState", () => {
    it("writes the parameter, page and next flag, and reads them back", () => {
        const text = writePagerState({ param: "page", page: 3, hasNext: true });

        expect(text).toBe("page:3:1");
        expect(readPagerState(text)).toEqual({ param: "page", page: 3, hasNext: true });
    });

    it("writes no fourth part for an empty query, and reads back no query", () => {
        const text = writePagerState({ param: "page", page: 1, hasNext: false, query: {} });

        expect(text).toBe("page:1:0");
        expect(readPagerState(text)).toEqual({ param: "page", page: 1, hasNext: false });
    });

    it("keeps a colon, an ampersand and an equals sign in a query value", () => {
        const query = { q: "a:b&c=d", tag: "x y", other: "1" };
        const text = writePagerState({ param: "p", page: 2, hasNext: true, query });

        expect(text.split(":")).toHaveLength(4);
        expect(readPagerState(text)).toEqual({ param: "p", page: 2, hasNext: true, query });
    });

    it("keeps the last of a repeated query parameter", () => {
        expect(readPagerState("page:2:1:tag=a&tag=b")?.query).toEqual({ tag: "b" });
    });

    it("refuses a state with too few or too many parts", () => {
        expect(readPagerState("page:2")).toBeNull();
        expect(readPagerState("page:2:1:q=a:extra")).toBeNull();
        expect(readPagerState("page:2:1:q=a:b:c")).toBeNull();
    });

    it("refuses an empty value, an empty parameter and a page that is not a whole number from 1", () => {
        expect(readPagerState(undefined)).toBeNull();
        expect(readPagerState("")).toBeNull();
        expect(readPagerState(":2:1")).toBeNull();
        expect(readPagerState("page:0:1")).toBeNull();
        expect(readPagerState("page:-1:1")).toBeNull();
        expect(readPagerState("page:1.5:1")).toBeNull();
        expect(readPagerState("page:two:1")).toBeNull();
    });

    it("reads any next flag but 1 as no next page", () => {
        expect(readPagerState("page:2:0")?.hasNext).toBe(false);
        expect(readPagerState("page:2:2")?.hasNext).toBe(false);
        expect(readPagerState("page:2:true")?.hasNext).toBe(false);
    });
});

describe("the pager links", () => {
    it("draws a previous and a next link on a middle page, each carrying the rest of the query", async () => {
        const html = await draw(writePagerState({ param: "page", page: 3, hasNext: true, query: { q: "x", page: "9" } }));

        expect(html).toContain('href="?q=x&amp;page=2"');
        expect(html).toContain('href="?q=x&amp;page=4"');
        expect(html).toContain('rel="prev"');
        expect(html).toContain('rel="next"');
        expect(html).not.toContain("page=9");
    });

    it("draws no previous link on page one, and only a next link", async () => {
        const html = await draw(writePagerState({ param: "page", page: 1, hasNext: true }));

        expect(html).not.toContain('rel="prev"');
        expect(html).toContain('href="?page=2"');
    });

    it("draws no next link on the last page, and only a previous link", async () => {
        const html = await draw(writePagerState({ param: "page", page: 4, hasNext: false }));

        expect(html).not.toContain('rel="next"');
        expect(html).toContain('href="?page=3"');
    });

    it("draws nothing for a state it cannot read", async () => {
        expect(await draw("garbage")).toBe("");
        expect(await draw(undefined)).toBe("");
    });
});
