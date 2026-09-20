/*
 * Capturing a live site as the approved design (#83).
 *
 * The look check compares a reference against the rebuilt page, and for a site being replaced the
 * reference is the site itself. Pointing the pair straight at the live URL works and is what the
 * pair list already allows, but it makes the gate depend on a third party being up, on whatever the
 * site deployed this morning, and on the runner reaching the internet at all. So before a conversion
 * starts, the design is captured once and committed: from then on the gate compares the rebuild
 * against the page everybody agreed on, and the day the live site changes underneath it, it does not
 * quietly move the target.
 *
 * What comes out is one file that needs nothing else. The stylesheets are pulled in as `<style>`
 * blocks, the fonts and the images they name become data URIs, the images in the markup become data
 * URIs, and every script is taken out. The scripts go because a captured page is a picture of a
 * moment: a script re-running against an API that has moved on redraws the page into something the
 * design was never approved as. Anything a script drew is already in the serialised DOM.
 *
 * Fetching happens through Playwright's own request context and not from inside the page, so a font
 * or an image on another host comes in rather than being refused by CORS and quietly left out.
 *
 *     node look/capture-fixture.ts https://baryo.dev/ look/fixtures/baryo-dev/home.html
 *
 * The string work is all here rather than in the browser so it can be tested without one, which is
 * what look/capture-fixture.test.ts does.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** One asset, as it came back. */
export interface Fetched {
    contentType: string;
    body: Buffer;
}

/** Reads one URL. Null for anything that did not come back, which is left as it was. */
export type Grab = (url: string) => Promise<Fetched | null>;

/**
 * The most one asset may weigh, and the most the finished file may.
 *
 * A fixture is committed and read by everyone who touches the site after this, so it is held to a
 * size a person would accept in a pull request. Going over is an error rather than a silent trim:
 * a design missing its hero image is not the design.
 */
export const MAX_ASSET_BYTES = 3_000_000;
export const MAX_FIXTURE_BYTES = 12_000_000;

export function dataUri(contentType: string, body: Buffer): string {
    const type = contentType.split(";")[0].trim() || "application/octet-stream";
    return `data:${type};base64,${body.toString("base64")}`;
}

/** The value of one attribute of one tag, unquoted. Undefined when the tag does not carry it. */
export function attrOf(tag: string, name: string): string | undefined {
    const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
    if (!found) return undefined;
    return found[2] ?? found[3] ?? found[4];
}

/*
 * `url(...)` targets in a stylesheet, skipping what is already inline.
 *
 * One quantifier over characters that cannot close the call, so there is one way to match and
 * nothing to backtrack over. A stylesheet is untrusted input here in the same way an editor's
 * markdown is: it came off somebody else's server.
 */
const CSS_URL = /url\(\s*("([^"\n]{0,2000})"|'([^'\n]{0,2000})'|([^)'"\n]{0,2000}))\s*\)/g;

export function cssUrls(css: string): string[] {
    const out: string[] = [];
    for (const found of css.matchAll(CSS_URL)) {
        const url = (found[2] ?? found[3] ?? found[4] ?? "").trim();
        if (url && !url.startsWith("data:") && !url.startsWith("#")) out.push(url);
    }
    return [...new Set(out)];
}

/** The stylesheet with every `url(...)` the replacer answers for swapped out. Null keeps the original. */
export function replaceCssUrls(css: string, replace: (url: string) => string | null): string {
    return css.replace(CSS_URL, (whole, _quoted, doubled, singled, bare) => {
        const url = (doubled ?? singled ?? bare ?? "").trim();
        if (!url || url.startsWith("data:") || url.startsWith("#")) return whole;
        const swapped = replace(url);
        return swapped === null ? whole : `url("${swapped}")`;
    });
}

/** An absolute URL, or null for one that is not a URL at all. */
function absolute(url: string, base: string): string | null {
    try {
        const resolved = new URL(url, base);
        return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : null;
    } catch {
        return null;
    }
}

/*
 * A stylesheet with its own assets inlined.
 *
 * One level down and no further: a font file names nothing, and an `@import` is followed because a
 * stylesheet that imports another is common enough that leaving it out would lose the page's type.
 */
async function inlineCss(css: string, base: string, grab: Grab, seen: Set<string>): Promise<string> {
    const imports = new Map<string, string>();
    for (const found of css.matchAll(/@import\s+(?:url\()?\s*["']([^"'\n]{1,2000})["']\s*\)?\s*;/g)) {
        const url = absolute(found[1], base);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const got = await grab(url);
        if (!got || got.body.byteLength > MAX_ASSET_BYTES) continue;
        imports.set(found[0], await inlineCss(got.body.toString("utf8"), url, grab, seen));
    }
    let out = css;
    for (const [statement, replacement] of imports) out = out.split(statement).join(replacement);

    const replacements = new Map<string, string>();
    for (const raw of cssUrls(out)) {
        const url = absolute(raw, base);
        if (!url) continue;
        const got = await grab(url);
        if (!got || got.body.byteLength > MAX_ASSET_BYTES) continue;
        replacements.set(raw, dataUri(got.contentType, got.body));
    }
    return replaceCssUrls(out, (url) => replacements.get(url) ?? null);
}

/** Every `<link rel="stylesheet">` replaced by the stylesheet itself, assets and all. */
export async function inlineStylesheets(html: string, base: string, grab: Grab): Promise<string> {
    const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const seen = new Set<string>();
    let out = html;
    for (const tag of tags) {
        const rel = (attrOf(tag, "rel") ?? "").toLowerCase();
        const href = attrOf(tag, "href");
        if (!rel.split(/\s+/).includes("stylesheet") || !href) continue;
        const url = absolute(href, base);
        if (!url) continue;
        const got = await grab(url);
        if (!got || got.body.byteLength > MAX_ASSET_BYTES) continue;
        const css = await inlineCss(got.body.toString("utf8"), url, grab, seen);
        out = out.replace(tag, `<style data-look-fixture="${escapeAttribute(url)}">\n${css}\n</style>`);
    }
    return out;
}

/** Every `<img>` carrying its own bytes, with the responsive set dropped so one source is left. */
export async function inlineImages(html: string, base: string, grab: Grab): Promise<string> {
    const tags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    let out = html;
    for (const tag of tags) {
        const src = attrOf(tag, "src");
        if (!src || src.startsWith("data:")) continue;
        const url = absolute(src, base);
        if (!url) continue;
        const got = await grab(url);
        if (!got || got.body.byteLength > MAX_ASSET_BYTES) continue;
        const replaced = tag
            .replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
            .replace(/\ssizes\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
            .replace(/\sloading\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
            .replace(/(\ssrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${dataUri(got.contentType, got.body)}"`);
        out = out.replace(tag, replaced);
    }
    return out;
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/*
 * Every script, and every hint that one is coming.
 *
 * A captured page is a picture of a moment. A script left in re-runs against an API that has moved
 * on and redraws the page into something nobody approved, and the look check would then be comparing
 * the rebuild against today's data rather than against the design. Whatever the scripts drew before
 * the capture is already in the serialised DOM.
 */
export function stripScripts(html: string): string {
    return html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<script\b[^>]*\/>/gi, "")
        .replace(/<link\b[^>]*\bas\s*=\s*["']?script["']?[^>]*>/gi, "")
        .replace(/<link\b[^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*>/gi, "");
}

/** What `rel` values are a hint to go and fetch something, rather than something the page needs. */
const HINTS = ["preload", "prefetch", "preconnect", "dns-prefetch"];

/*
 * The fetch hints.
 *
 * Every asset the page needs is inside the file by the time this runs, so a preload is a request to
 * a host the fixture is not supposed to depend on any more. Left in, a capture opened with no network
 * waits on four fonts that are already in its own stylesheet.
 */
export function stripFetchHints(html: string): string {
    return html.replace(/<link\b[^>]*>/gi, (tag) => {
        const rel = (attrOf(tag, "rel") ?? "").toLowerCase().split(/\s+/);
        return rel.some((value) => HINTS.includes(value)) ? "" : tag;
    });
}

/*
 * What a capture produced, for the caller to report before it writes anything.
 *
 * Named apart from `look/capture.ts`'s `Capture` and `CaptureOptions` on purpose. The two modules
 * do different jobs, one writes a file and one takes a screenshot, and a file importing both under
 * one name is how the wrong one gets used.
 */
export interface FixtureCapture {
    html: string;
    bytes: number;
}

export interface FixtureOptions {
    /** The width the page is laid out at while it is read. Both fixture widths render from one file. */
    width?: number;
    viewportHeight?: number;
    /** The clock the page is pinned to, so anything it computes from the time is captured once. */
    fixedTime?: string;
    /** URL globs refused during the capture: analytics, and anything that pulls live content. */
    block?: string[];
    timeout?: number;
}

/*
 * The live page, read the way the look check reads one, then made self-contained.
 *
 * The context settings are `look/capture.ts`'s, for the same reasons: a fixture captured with the
 * runner's own dark mode or locale would be compared against a rebuild that had neither.
 */
export async function captureFixture(url: string, options: FixtureOptions = {}): Promise<FixtureCapture> {
    const { chromium } = await import("@playwright/test");
    const timeout = options.timeout ?? 60_000;
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: { width: options.width ?? 1280, height: options.viewportHeight ?? 900 },
            deviceScaleFactor: 1,
            reducedMotion: "reduce",
            colorScheme: "light",
            forcedColors: "none",
            locale: "en-US",
            timezoneId: "UTC",
            serviceWorkers: "block",
        });
        context.setDefaultTimeout(timeout);
        for (const pattern of options.block ?? []) await context.route(pattern, (route) => route.abort());

        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(options.fixedTime ?? "2026-01-01T09:00:00.000Z"));
        await page.goto(url, { waitUntil: "load", timeout });

        // The same settling the check does, so what is captured is the page after its fonts have
        // arrived and its lazy images have been asked for, not the page mid paint.
        await page.evaluate(async () => {
            for (const element of Array.from(document.querySelectorAll("img, iframe"))) {
                (element as HTMLImageElement).loading = "eager";
            }
            const step = window.innerHeight;
            for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
                window.scrollTo(0, y);
                await new Promise((done) => requestAnimationFrame(() => done(null)));
            }
            window.scrollTo(0, 0);
            await Promise.all(
                Array.from(document.images).map((image) =>
                    image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
                ),
            );
            await document.fonts.ready;
        });
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

        /*
         * Every address made absolute before the DOM is serialised, by reading each one back
         * through the property that resolves it. After this the markup carries no path that only
         * means something next to the original document.
         */
        await page.evaluate(() => {
            for (const image of Array.from(document.images)) {
                const chosen = image.currentSrc || image.src;
                if (chosen) image.setAttribute("src", chosen);
                image.removeAttribute("srcset");
            }
            for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>("link[href]"))) {
                link.setAttribute("href", link.href);
            }
            for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
                anchor.setAttribute("href", anchor.href);
            }
        });

        const serialised = await page.evaluate(() => document.documentElement.outerHTML);
        const grab: Grab = async (address) => {
            try {
                const response = await context.request.get(address, { timeout, maxRetries: 1 });
                if (!response.ok()) return null;
                return {
                    contentType: response.headers()["content-type"] ?? "application/octet-stream",
                    body: await response.body(),
                };
            } catch {
                return null;
            }
        };

        let html = stripScripts(`<!doctype html>\n${serialised}`);
        html = await inlineStylesheets(html, url, grab);
        html = await inlineImages(html, url, grab);
        // Last, so the stylesheets are still links while they are being pulled in.
        html = stripFetchHints(html);

        const bytes = Buffer.byteLength(html, "utf8");
        if (bytes > MAX_FIXTURE_BYTES) {
            throw new Error(
                `the capture of ${url} is ${bytes} bytes, over the ${MAX_FIXTURE_BYTES} a committed fixture may weigh`,
            );
        }
        return { html, bytes };
    } finally {
        await browser.close();
    }
}

async function main(argv: string[]): Promise<number> {
    const [url, out] = argv;
    if (!url || !out) {
        console.error("usage: node look/capture-fixture.ts <url> <file> [blocked-url-glob ...]");
        return 2;
    }
    const capture = await captureFixture(url, { block: argv.slice(2) });
    const path = resolve(out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, capture.html);
    console.log(`captured ${url} to ${path}, ${capture.bytes} bytes`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        },
    );
}
