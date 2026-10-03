import { describe, expect, it } from "vitest";
import { isImageSrc, isInlineImage, readFile, readFileLink, readImage, shareImageUrl } from "./media.js";

/*
 * The shapes barakoCMS 4.6 delivers for an image or a file (#1099, #1105), and the rule about what
 * may reach an `<img src>`: http, https, a site path, or an inline image of a type the API allows.
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const FILE = {
    id: "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    url: "https://files.example/6f9619ff.png",
    fileName: "harbour.png",
    contentType: "image/png",
    size: 48213,
    alt: "Boats at dawn",
    caption: null,
};
const PDF = { ...FILE, url: "/api/public/files/abc", fileName: "menu.pdf", contentType: "application/pdf", alt: null };

describe("readImage", () => {
    it("reads an inline image with its alt", () => {
        expect(readImage({ url: PNG, alt: "Acme logo" })).toEqual({ src: PNG, alt: "Acme logo" });
    });

    it("reads an image file with the alt written on the file", () => {
        expect(readImage(FILE)).toEqual({ src: FILE.url, alt: "Boats at dawn" });
    });

    it("keeps a width and a height only when the value carries them", () => {
        expect(readImage({ ...FILE, width: 640, height: 480 })).toMatchObject({ width: 640, height: 480 });
        expect(readImage(FILE)).not.toHaveProperty("width");
    });

    it("reads a URL held as text, as an image field always held one", () => {
        expect(readImage("https://files.example/a.jpg")).toEqual({ src: "https://files.example/a.jpg" });
    });

    it("is absent for a file that is not an image", () => {
        expect(readImage(PDF)).toBeUndefined();
    });

    it("is absent for an SVG data URI, which the API refuses because it can carry script", () => {
        expect(readImage({ url: "data:image/svg+xml;base64,PHN2Zz4=", alt: "x" })).toBeUndefined();
    });

    it("is absent for a data URI that is not an image", () => {
        expect(readImage({ url: "data:text/html;base64,PGI+", alt: "x" })).toBeUndefined();
    });

    it("is absent for a script URL, as text or in an object", () => {
        expect(readImage("javascript:alert(1)")).toBeUndefined();
        expect(readImage({ ...FILE, url: "javascript:alert(1)" })).toBeUndefined();
    });

    it("is absent for a missing field, the way delivery leaves out a file it will not serve", () => {
        expect(readImage(undefined)).toBeUndefined();
        expect(readImage(null)).toBeUndefined();
    });
});

describe("isImageSrc", () => {
    it("takes http, https, a site path and an allowed inline image", () => {
        expect(isImageSrc("http://files.example/a.png")).toBe(true);
        expect(isImageSrc("https://files.example/a.png")).toBe(true);
        expect(isImageSrc("/uploads/a.png")).toBe(true);
        expect(isImageSrc(PNG)).toBe(true);
    });

    it("refuses mailto, another host by //, and a data URI of another type", () => {
        expect(isImageSrc("mailto:a@example.com")).toBe(false);
        expect(isImageSrc("//evil.example/a.png")).toBe(false);
        expect(isImageSrc("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    });

    it("refuses an inline image longer than the API would ever deliver", () => {
        const long = `data:image/png;base64,${"A".repeat(90_000)}`;
        expect(isInlineImage(long)).toBe(false);
        expect(isImageSrc(long)).toBe(false);
    });
});

describe("shareImageUrl", () => {
    it("keeps an address a crawler can fetch", () => {
        expect(shareImageUrl("https://files.example/a.png")).toBe("https://files.example/a.png");
    });

    it("never gives a share card an inline image", () => {
        expect(shareImageUrl(PNG)).toBeUndefined();
    });
});

describe("files", () => {
    it("reads every member delivery sends for a public file", () => {
        expect(readFile(FILE)).toEqual({
            id: FILE.id,
            url: FILE.url,
            fileName: "harbour.png",
            contentType: "image/png",
            size: 48213,
            alt: "Boats at dawn",
        });
    });

    it("does not read an inline image as a file", () => {
        expect(readFile({ url: PNG, alt: "x" })).toBeUndefined();
    });

    it("links a file that is not an image, by its name", () => {
        expect(readFileLink(PDF)).toEqual({ href: "/api/public/files/abc", label: "menu.pdf" });
    });

    it("does not link a file whose address is not http, https or a site path", () => {
        expect(readFileLink({ ...PDF, url: "javascript:alert(1)" })).toBeUndefined();
    });
});
