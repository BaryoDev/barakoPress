import { afterEach, describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import { generatedShareImages, shareImageHref, SHARE_IMAGE_ROUTE } from "./share-image.js";
import { isSharePath, loadFont, SHARE_IMAGE_CACHE_CONTROL, shareTitle } from "./routes/share-image.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = defineConfig({ site: { name: "T", url: "https://t.example" } });
const before = process.env.PRESS_SHARE_IMAGE_FONT;
afterEach(() => {
    if (before === undefined) delete process.env.PRESS_SHARE_IMAGE_FONT;
    else process.env.PRESS_SHARE_IMAGE_FONT = before;
});

describe("generatedShareImages", () => {
    it("advertises nothing while no font is configured", () => {
        delete process.env.PRESS_SHARE_IMAGE_FONT;
        expect(generatedShareImages(config, "/about")).toBeUndefined();
    });

    it("points at the route on the site's origin once a font is configured", () => {
        process.env.PRESS_SHARE_IMAGE_FONT = "/fonts/brand.ttf";
        expect(generatedShareImages(config, "/about/team")).toEqual([
            `https://t.example${SHARE_IMAGE_ROUTE}?path=%2Fabout%2Fteam`,
        ]);
    });

    it("advertises nothing for a page with no path", () => {
        process.env.PRESS_SHARE_IMAGE_FONT = "/fonts/brand.ttf";
        expect(generatedShareImages(config, undefined)).toBeUndefined();
    });

    it("encodes the path", () => {
        expect(shareImageHref("https://t.example", "/a&b")).toBe("https://t.example/share-image?path=%2Fa%26b");
    });
});

describe("shareTitle", () => {
    it("flattens whitespace", () => {
        expect(shareTitle("  one \n two  ")).toBe("one two");
    });

    it("cuts a long title with an ellipsis", () => {
        const out = shareTitle("x".repeat(500));
        expect(out.length).toBe(140);
        expect(out.endsWith("…")).toBe(true);
    });
});

describe("loadFont", () => {
    it("reads the file's bytes", async () => {
        const file = join(mkdtempSync(join(tmpdir(), "font-")), "f.ttf");
        writeFileSync(file, Buffer.from([1, 2, 3]));
        const font = await loadFont(file);
        expect([...new Uint8Array(font)]).toEqual([1, 2, 3]);
    });

    it("rejects for a file that is not there, and tries again next time", async () => {
        const file = join(mkdtempSync(join(tmpdir(), "font-")), "late.ttf");
        await expect(loadFont(file)).rejects.toThrow();
        writeFileSync(file, Buffer.from([9]));
        expect(new Uint8Array(await loadFont(file))[0]).toBe(9);
    });
});

describe("the route's guards", () => {
    it("takes an absolute path and refuses a missing, relative or oversized one", () => {
        expect(isSharePath("/about")).toBe(true);
        expect(isSharePath(null)).toBe(false);
        expect(isSharePath("about")).toBe(false);
        expect(isSharePath(`/${"a".repeat(600)}`)).toBe(false);
    });

    it("does not let a cache keep a card for a year", () => {
        expect(SHARE_IMAGE_CACHE_CONTROL).not.toContain("immutable");
        expect(SHARE_IMAGE_CACHE_CONTROL).toContain("max-age=0");
    });
});
