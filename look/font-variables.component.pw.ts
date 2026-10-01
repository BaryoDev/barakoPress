/*
 * Who wins `--font-sans` when the engine's head CSS and a site's stylesheet are on one page
 * (barakoPress #115).
 *
 * The engine used to write `--font-sans`, `--font-display` and `--font-mono` on `:root`, inline in
 * the head and after the site's stylesheet, so a site's own tokens of the same names lost. Its
 * variables are `--bp-font-*` now, and the old names are kept for a release as registered initial
 * values (`@property`), which apply only where nothing declares the name.
 *
 * This is measured in a browser because a string match on the emitted CSS cannot say who wins. The
 * alternatives that read right and are wrong: an alias under `:where(:root)` weighs nothing but is
 * unlayered, so it beats Tailwind's `@layer theme` tokens, and an alias in a layer of its own orders
 * after the site's layers, because the head style comes after the stylesheet.
 *
 * The CSS under test is what the compiled package emits (`dist`, built by `npm run build:package`)
 * and the stylesheet it ships, not a copy.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser } from "@playwright/test";

import { resolveTheme, themeVariablesCss } from "../dist/theme.js";

const here = dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(join(here, "..", "src", "styles.css"), "utf8");

const theme = resolveTheme({
    fonts: { body: "'Engine Body', serif", heading: "'Engine Heading', serif", mono: "'Engine Mono', monospace" },
});
const engineCss = themeVariablesCss(theme);

const SITE_VALUES = `--font-sans:"Site Sans";--font-display:"Site Display";--font-mono:"Site Mono"`;

// How a site might define the names. The Tailwind one is the shape v4 compiles `@theme` into: a
// layer order statement, then the tokens on `:root, :host` inside `@layer theme`.
const SITES: Record<string, string> = {
    "a plain :root rule": `:root{${SITE_VALUES}}`,
    "a Tailwind @theme block": `@layer theme,base,components,utilities;@layer theme{:root,:host{${SITE_VALUES}}}`,
    "a layer of the site's own": `@layer tokens{:root{${SITE_VALUES}}}`,
    "a rule on html": `html{${SITE_VALUES}}`,
    "a :where(:root) rule": `:where(:root){${SITE_VALUES}}`,
};

const PROBES = `
<p id="old-sans" style="font-family:var(--font-sans)">x</p>
<p id="old-display" style="font-family:var(--font-display)">x</p>
<p id="old-mono" style="font-family:var(--font-mono)">x</p>
<p id="bp-sans" style="font-family:var(--bp-font-sans)">x</p>
<p id="bp-display" style="font-family:var(--bp-font-display)">x</p>
<p id="bp-mono" style="font-family:var(--bp-font-mono)">x</p>
<p id="body-text">x</p>
<h2 id="heading">x</h2>
<code id="code">x</code>`;

function doc(headStyles: string[]): string {
    const styles = headStyles.map((s) => `<style>${s}</style>`).join("");
    return `<!doctype html><html><head>${styles}</head><body>${PROBES}</body></html>`;
}

async function families(browser: Browser, html: string): Promise<Record<string, string>> {
    const context = await browser.newContext({ javaScriptEnabled: true });
    const page = await context.newPage();
    await page.setContent(html);
    const out = await page.evaluate(() => {
        const ids = [
            "old-sans",
            "old-display",
            "old-mono",
            "bp-sans",
            "bp-display",
            "bp-mono",
            "body-text",
            "heading",
            "code",
        ];
        return Object.fromEntries(
            ids.map((id) => {
                const el = document.getElementById(id);
                return [id, el ? getComputedStyle(el).fontFamily : "(missing)"];
            }),
        );
    });
    await context.close();
    return out;
}

test.describe.configure({ mode: "parallel" });

for (const [name, siteCss] of Object.entries(SITES)) {
    // The head style after the stylesheet is the order a page is served in. The other order is here
    // because a site that draws its own head may put them either way round.
    for (const order of ["after", "before"] as const) {
        test(`${name} keeps its own fonts, with the engine's style ${order} it`, async ({ browser }) => {
            const got = await families(browser, doc(order === "after" ? [siteCss, engineCss] : [engineCss, siteCss]));

            expect(got["old-sans"]).toContain("Site Sans");
            expect(got["old-display"]).toContain("Site Display");
            expect(got["old-mono"]).toContain("Site Mono");
            expect(got["bp-sans"]).toContain("Engine Body");
            expect(got["bp-display"]).toContain("Engine Heading");
            expect(got["bp-mono"]).toContain("Engine Mono");
        });
    }
}

test("a site that defines none of the old names still reads the theme's fonts through them", async ({ browser }) => {
    const got = await families(browser, doc([`body{color:#111}`, engineCss]));

    expect(got["old-sans"]).toContain("Engine Body");
    expect(got["old-display"]).toContain("Engine Heading");
    expect(got["old-mono"]).toContain("Engine Mono");
    expect(got["bp-sans"]).toContain("Engine Body");
});

test("the shipped stylesheet draws with the theme's fonts, whatever a site sets the old names to", async ({ browser }) => {
    const got = await families(browser, doc([stylesCss, SITES["a Tailwind @theme block"], engineCss]));

    expect(got["body-text"]).toContain("Engine Body");
    expect(got["heading"]).toContain("Engine Heading");
    expect(got["code"]).toContain("Engine Mono");
    expect(got["old-sans"]).toContain("Site Sans");
});

test("the shipped stylesheet alone carries its own defaults under both names", async ({ browser }) => {
    const got = await families(browser, doc([stylesCss]));

    expect(got["body-text"]).toContain("Manrope");
    expect(got["heading"]).toContain("Sora");
    expect(got["code"]).toContain("JetBrains Mono");
    expect(got["bp-sans"]).toContain("Manrope");
    expect(got["old-sans"]).toContain("Manrope");
    expect(got["old-display"]).toContain("Sora");
    expect(got["old-mono"]).toContain("JetBrains Mono");
});

test("the theme's fonts replace the stylesheet's defaults under the old names too", async ({ browser }) => {
    const got = await families(browser, doc([stylesCss, engineCss]));

    expect(got["old-sans"]).toContain("Engine Body");
    expect(got["old-display"]).toContain("Engine Heading");
    expect(got["old-mono"]).toContain("Engine Mono");
});

/*
 * A theme font may be built from a variable, which is how a face from next/font is named. A
 * registered initial value cannot hold a `var()`: the browser drops the whole registration, and the
 * old name then has no value at all. So the old name gets the default stack for that role, and the
 * real value is under `--bp-font-*` only.
 */
test("a theme font built from a variable leaves the old name a real face, and a site still wins", async ({ browser }) => {
    const fromVariable = themeVariablesCss(
        resolveTheme({ fonts: { body: "var(--font-inter), sans-serif", heading: "'Engine Heading', serif !important" } }),
    );
    const siteFace = `:root{--font-inter:"Inter"}`;

    const alone = await families(browser, doc([siteFace, fromVariable]));
    expect(alone["bp-sans"]).toContain("Inter");
    expect(alone["old-sans"]).toContain("Manrope");
    expect(alone["old-display"]).toContain("Sora");
    expect(alone["old-mono"]).toContain("JetBrains Mono");

    const withSite = await families(browser, doc([siteFace, SITES["a Tailwind @theme block"], fromVariable]));
    expect(withSite["bp-sans"]).toContain("Inter");
    expect(withSite["old-sans"]).toContain("Site Sans");
    expect(withSite["old-display"]).toContain("Site Display");
});

/*
 * The stylesheet's rules read `--bp-font-*` and nothing else. A site that used to restyle them by
 * setting `--font-sans` sets `--bp-font-sans` instead: on the root when it draws its own head, and
 * further in (the head style is on the root and comes later) when it uses the site layout.
 */
test("a site restyles the shipped stylesheet through the engine's names, not the old ones", async ({ browser }) => {
    const oldName = await families(browser, doc([stylesCss, `:root{--font-sans:"Inter"}`]));
    expect(oldName["body-text"]).toContain("Manrope");
    expect(oldName["body-text"]).not.toContain("Inter");

    const ownHead = await families(
        browser,
        doc([stylesCss, `:root{--bp-font-sans:"Inter";--bp-font-display:"Lora";--bp-font-mono:"Fira Code"}`]),
    );
    expect(ownHead["body-text"]).toContain("Inter");
    expect(ownHead["heading"]).toContain("Lora");
    expect(ownHead["code"]).toContain("Fira Code");

    const withLayout = await families(browser, doc([stylesCss, `body{--bp-font-sans:"Inter"}`, engineCss]));
    expect(withLayout["body-text"]).toContain("Inter");
});

test("a font name cannot close the style element or the rule it is written into", async ({ browser }) => {
    const hostile = themeVariablesCss(
        resolveTheme({
            fonts: {
                body: `x;}</style><script>document.title="broke out"</script><style>body{color:red`,
                heading: `y;} body{color:rgb(1, 2, 3)} :root{--z:`,
                mono: `'Engine Mono', monospace`,
            },
        }),
    );
    const context = await browser.newContext({ javaScriptEnabled: true });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><title>intact</title><style>${hostile}</style></head><body>${PROBES}</body></html>`);

    expect(await page.title()).toBe("intact");
    expect(await page.locator("head style").count()).toBe(1);
    expect(await page.locator("script").count()).toBe(0);
    const body = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(body).toBe("rgb(0, 0, 0)");
    // The declarations after the hostile ones are still read, so nothing ran on past its own value.
    const mono = await page.evaluate(() => getComputedStyle(document.getElementById("bp-mono")!).fontFamily);
    expect(mono).toContain("Engine Mono");
    const oldMono = await page.evaluate(() => getComputedStyle(document.getElementById("old-mono")!).fontFamily);
    expect(oldMono).toContain("Engine Mono");
    await context.close();
});
