import { describe, expect, it } from "vitest";

import {
    MAX_ASSET_BYTES,
    attrOf,
    cssUrls,
    dataUri,
    inlineImages,
    inlineStylesheets,
    replaceCssUrls,
    stripFetchHints,
    stripScripts,
    type Fetched,
    type Grab,
} from "./capture-fixture.js";

/*
 * The capture that turns a live site into the approved design on disk (#83).
 *
 * Everything asserted here is the string work, which is the half that decides whether the fixture
 * still renders the page a year from now. The browser half is proved by running it: the baryo.dev
 * fixture in look/fixtures is what it produced.
 */

const BASE = "https://site.example/";

/** A stand-in server: what is in the map comes back, anything else did not answer. */
function serving(files: Record<string, { type: string; body: string | Buffer }>): { grab: Grab; asked: string[] } {
    const asked: string[] = [];
    const grab: Grab = async (url) => {
        asked.push(url);
        const found = files[url];
        if (!found) return null;
        const body = Buffer.isBuffer(found.body) ? found.body : Buffer.from(found.body);
        return { contentType: found.type, body } satisfies Fetched;
    };
    return { grab, asked };
}

describe("reading a tag", () => {
    it("reads an attribute however it was quoted", () => {
        expect(attrOf('<link rel="stylesheet" href="/a.css">', "href")).toBe("/a.css");
        expect(attrOf("<link rel='stylesheet' href='/a.css'>", "href")).toBe("/a.css");
        expect(attrOf("<link rel=stylesheet href=/a.css>", "href")).toBe("/a.css");
    });

    it("says nothing for an attribute the tag does not carry", () => {
        expect(attrOf('<img src="/a.png">', "srcset")).toBeUndefined();
    });
});

describe("the urls inside a stylesheet", () => {
    it("finds every one, once, whatever the quotes, and leaves what is already inline alone", () => {
        const css = `
          @font-face { src: url("/f.woff2") format("woff2"); }
          .a { background: url('/bg.png'); }
          .b { background: url(/bg.png); }
          .c { background: url(data:image/png;base64,AAA); }
          .d { mask: url(#clip); }
        `;
        const urls = cssUrls(css);

        expect(urls.length).toBeGreaterThan(0);
        expect(urls).toEqual(["/f.woff2", "/bg.png"]);
    });

    it("swaps out only what the replacer answers for", () => {
        const css = `.a{background:url(/bg.png)}.b{background:url(/keep.png)}`;
        const out = replaceCssUrls(css, (url) => (url === "/bg.png" ? "data:image/png;base64,ZZZ" : null));

        expect(out).toContain('url("data:image/png;base64,ZZZ")');
        expect(out).toContain("url(/keep.png)");
    });

    it("writes a data uri with the type it came back as", () => {
        expect(dataUri("image/png; charset=binary", Buffer.from("hi"))).toBe("data:image/png;base64,aGk=");
    });
});

describe("the scripts", () => {
    it("takes out every script, and the hints that one is coming", () => {
        const html = `<head><script src="/a.js" async=""></script><script>window.x=1</script>` +
            `<link rel="preload" as="script" href="/b.js"/><link rel="modulepreload" href="/c.js"/>` +
            `<link rel="stylesheet" href="/s.css"/></head><body><p>kept</p></body>`;
        const out = stripScripts(html);

        expect(out).not.toContain("<script");
        expect(out).not.toContain("window.x=1");
        expect(out).not.toContain("/b.js");
        expect(out).not.toContain("/c.js");
        // The stylesheet is not a script, and the page is still a page.
        expect(out).toContain('href="/s.css"');
        expect(out).toContain("<p>kept</p>");
    });
});

describe("making a page stand on its own", () => {
    it("brings a stylesheet in, with its fonts and its images", async () => {
        const { grab, asked } = serving({
            "https://site.example/s.css": {
                type: "text/css",
                body: `@font-face{src:url(/f.woff2)}.hero{background:url("/bg.png")}`,
            },
            "https://site.example/f.woff2": { type: "font/woff2", body: "FONT" },
            "https://site.example/bg.png": { type: "image/png", body: "PNG" },
        });
        const out = await inlineStylesheets('<link rel="stylesheet" href="/s.css"/>', BASE, grab);

        expect(asked.length).toBe(3);
        expect(out).not.toContain("<link");
        expect(out).toContain("<style");
        expect(out).toContain(`url("data:font/woff2;base64,${Buffer.from("FONT").toString("base64")}")`);
        expect(out).toContain(`url("data:image/png;base64,${Buffer.from("PNG").toString("base64")}")`);
    });

    it("follows an import, because a stylesheet that imports another carries the page's type", async () => {
        const { grab } = serving({
            "https://site.example/s.css": { type: "text/css", body: `@import url("/type.css");\n.a{color:red}` },
            "https://site.example/type.css": { type: "text/css", body: `@font-face{src:url(/f.woff2)}` },
            "https://site.example/f.woff2": { type: "font/woff2", body: "FONT" },
        });
        const out = await inlineStylesheets('<link rel="stylesheet" href="/s.css"/>', BASE, grab);

        expect(out).not.toContain("@import");
        expect(out).toContain("@font-face");
        expect(out).toContain("data:font/woff2;base64,");
        expect(out).toContain(".a{color:red}");
    });

    it("leaves a link that is not a stylesheet where it is", async () => {
        const { grab, asked } = serving({});
        const html = '<link rel="icon" href="/icon.png"/><link rel="preload" as="font" href="/f.woff2"/>';

        expect(await inlineStylesheets(html, BASE, grab)).toBe(html);
        expect(asked).toEqual([]);
    });

    it("gives an image its own bytes and drops the responsive set", async () => {
        const { grab } = serving({ "https://site.example/a.png": { type: "image/png", body: "PNG" } });
        const out = await inlineImages(
            '<img src="/a.png" srcset="/a.png 1x, /a2.png 2x" sizes="50vw" loading="lazy" alt="A"/>',
            BASE,
            grab,
        );

        expect(out).toContain(`src="data:image/png;base64,${Buffer.from("PNG").toString("base64")}"`);
        expect(out).not.toContain("srcset");
        expect(out).not.toContain("sizes=");
        // Nothing is left lazy: a fixture that waits for an observer is a fixture that captures blank.
        expect(out).not.toContain("loading=");
        expect(out).toContain('alt="A"');
    });

    it("leaves an image that did not come back as it was, rather than emptying it", async () => {
        const { grab } = serving({});
        const html = '<img src="https://cdn.other.example/a.png" alt="A"/>';

        expect(await inlineImages(html, BASE, grab)).toBe(html);
    });

    /*
     * A fixture is committed and read by whoever touches the site next, so one enormous asset is
     * left out rather than dragged in. The page still renders; the hero image is the one thing
     * missing, and it is visible in the fixture rather than hidden in a size nobody looks at.
     */
    it("leaves out an asset that is too big to commit", async () => {
        const { grab } = serving({
            "https://site.example/huge.png": { type: "image/png", body: Buffer.alloc(MAX_ASSET_BYTES + 1) },
        });
        const html = '<img src="/huge.png"/>';

        expect(await inlineImages(html, BASE, grab)).toBe(html);
    });
});

describe("the fetch hints", () => {
    it("takes out every hint, and leaves the links a page actually needs", () => {
        const html =
            '<link rel="preload" as="font" href="/f.woff2"/><link rel="dns-prefetch" href="//cdn.example"/>' +
            '<link rel="preconnect" href="https://cdn.example"/><link rel="prefetch" href="/next"/>' +
            '<link rel="icon" href="/icon.png"/><link rel="alternate" type="application/rss+xml" href="/feed"/>';
        const out = stripFetchHints(html);

        expect(out).not.toContain("preload");
        expect(out).not.toContain("dns-prefetch");
        expect(out).not.toContain("preconnect");
        expect(out).not.toContain("prefetch");
        expect(out).toContain('rel="icon"');
        expect(out).toContain('rel="alternate"');
    });
});

/*
 * The two CodeQL found on this change, and both are real: a fixture that still runs a script is a
 * fixture that redraws itself against today's data, which is the one thing the capture exists to
 * stop.
 */
describe("the scripts, awkwardly written", () => {
    it("takes out a script whose end tag carries spaces", () => {
        const out = stripScripts("<body><script>alert(1)</script ><p>kept</p></body>");

        expect(out).not.toContain("<script");
        expect(out).not.toContain("alert(1)");
        expect(out).toContain("<p>kept</p>");
    });

    it("takes out a script the first pass would have assembled out of the halves either side of it", () => {
        const out = stripScripts("<body><scr<script>x</script>ipt>alert(1)</script><p>kept</p></body>");

        expect(out).not.toContain("<script");
        expect(out).not.toContain("alert(1)");
        expect(out).toContain("<p>kept</p>");
    });

    it("drops an opening tag with no end tag rather than the rest of the document", () => {
        const out = stripScripts("<body><p>before</p><script src='/a.js'><p>after</p></body>");

        expect(out).not.toContain("<script");
        expect(out).toContain("<p>before</p>");
        expect(out).toContain("<p>after</p>");
    });
});
