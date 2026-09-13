import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as source from "./markdown.js";

/*
 * These run against the built `barakopress/markdown` entry, the file a browser bundle gets, and
 * against the source, so the rules are proven where a consumer meets them. The entry test reads
 * dist, so it needs `npm run build:package` first, which `npm ci` has already done through prepare.
 */

type MarkdownModule = typeof source;

const require = createRequire(import.meta.url);

// Held in a variable so a missing subpath fails the tests that use it, not the whole file.
const ENTRY = "barakopress/markdown";

async function builtEntry(): Promise<MarkdownModule> {
    return (await import(/* @vite-ignore */ ENTRY)) as MarkdownModule;
}

function specifiers(code: string): string[] {
    const found = code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)["']([^"']+)["']/gm);
    return [...found].map((m) => m[1]);
}

/** Every bare import reachable from a built file, following its relative imports. */
function bareImports(entry: string): { files: string[]; bare: string[] } {
    const files: string[] = [];
    const bare = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (files.includes(file)) continue;
        files.push(file);
        for (const spec of specifiers(readFileSync(file, "utf8"))) {
            if (spec.startsWith(".")) queue.push(resolve(dirname(file), spec));
            else bare.add(spec);
        }
    }
    return { files, bare: [...bare].sort() };
}

describe("the barakopress/markdown entry", () => {
    it("resolves to a built file that exports the renderer", async () => {
        const entry = await builtEntry();
        expect(typeof entry.renderMarkdown).toBe("function");
        expect(typeof entry.isSafeHref).toBe("function");
        expect(typeof entry.anchor).toBe("function");
        expect(entry.renderMarkdown("**hi**")).toBe("<p><strong>hi</strong></p>\n");
    });

    it("reaches nothing a browser bundle cannot load", () => {
        const { files, bare } = bareImports(require.resolve(ENTRY));
        expect(files.length).toBeGreaterThan(0);
        expect(files[0]).toMatch(/dist[\\/]markdown\.js$/);
        expect(bare).toEqual(["marked"]);
    });

    it("keeps the main entry exporting the same renderer", async () => {
        const main = await import("barakopress");
        const entry = await builtEntry();
        expect(main.renderMarkdown).toBe(entry.renderMarkdown);
        expect(main.isSafeHref).toBe(entry.isSafeHref);
        expect(main.anchor).toBe(entry.anchor);
    });
});

describe.each([
    ["barakopress/markdown", builtEntry],
    ["src/markdown.ts", async () => source],
])("renderMarkdown from %s treats the source as untrusted", (_name, load) => {
    it("renders nothing for an empty source", async () => {
        const { renderMarkdown } = await load();
        expect(renderMarkdown("")).toBe("");
    });

    it("renders headings with an id, and external links with rel", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown("# Spring roast\n\n[Guide](https://example.com/guide) [About](/about)");
        expect(html).toContain('<h1 id="spring-roast">Spring roast</h1>');
        expect(html).toContain('<a href="https://example.com/guide" rel="noopener noreferrer">Guide</a>');
        expect(html).toContain('<a href="/about">About</a>');
        expect(html).not.toContain("target=");
    });

    it("keeps the words of a javascript: link and drops the link", async () => {
        const { renderMarkdown } = await load();
        for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)"]) {
            const html = renderMarkdown(`[click me](${href})`);
            expect(html).toContain("click me");
            expect(html).not.toContain("<a");
            expect(html.toLowerCase()).not.toContain("javascript:");
        }
    });

    it("escapes a raw script tag into visible text", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown("before\n\n<script>alert(1)</script>\n\nafter");
        expect(html).not.toContain("<script");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("escapes inline HTML carrying an event handler", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown('hello <img src=x onerror="alert(1)"> there');
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });

    it("drops a data: image and escapes its alt text", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown("![x <b>bold</b> y](data:text/html,boom)");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("data:");
        expect(html).not.toContain("<b>");
    });

    it("cannot break out of an attribute through a title", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown('[a](https://example.com "x\\" onmouseover=\\"alert(1)")');
        expect(html).toContain('title="x&quot; onmouseover=&quot;alert(1)"');
        expect(html).not.toMatch(/"\s+onmouseover=/);
    });

    it("leaves heading ids out when asked", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown("## Body", { headingIds: false });
        expect(html).toBe("<h2>Body</h2>");
    });

    it("opens every link in a new tab when asked, and still drops an unsafe one", async () => {
        const { renderMarkdown } = await load();
        const html = renderMarkdown("[Guide](https://example.com) [About](/about) [x](javascript:alert(1))", {
            newTab: true,
        });
        expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Guide</a>');
        expect(html).toContain('<a href="/about" target="_blank" rel="noopener noreferrer">About</a>');
        expect(html.match(/<a /g)).toHaveLength(2);
        expect(html).not.toContain("javascript:");
    });

    it("keeps the defaults for a call after one with options", async () => {
        const { renderMarkdown } = await load();
        renderMarkdown("# A", { headingIds: false, newTab: true });
        expect(renderMarkdown("# A\n\n[b](/b)")).toBe('<h1 id="a">A</h1><p><a href="/b">b</a></p>\n');
    });

    it("allows http, https, mailto, relative and anchor destinations only", async () => {
        const { isSafeHref } = await load();
        expect(isSafeHref("https://example.com")).toBe(true);
        expect(isSafeHref("http://example.com")).toBe(true);
        expect(isSafeHref("mailto:a@example.com")).toBe(true);
        expect(isSafeHref("/about")).toBe(true);
        expect(isSafeHref("#top")).toBe(true);
        expect(isSafeHref("data:text/html,x")).toBe(false);
        expect(isSafeHref("vbscript:x")).toBe(false);
    });
});
