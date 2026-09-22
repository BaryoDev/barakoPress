/*
 * A page laid out wider than the phone it was measured on, three times now: a four column band
 * (#83), a sticky bar with an unbroken command in it (found converting barakocms.com, #101), and
 * long inline code with nowhere to break plus a pre that lost its own scroller to a flex ancestor
 * (#101 again). All three were invisible to a markup assertion, because none of them are wrong
 * markup: they are geometry, and only a real browser lays a page out.
 *
 * So this loads real pages, rendered through the real compiled package by
 * build-viewport-fixtures.mjs, at a 390px viewport, and fails if the document is wider than that.
 * One of the two fixtures is built to carry the long token the issue measured; the other is the
 * baryo.dev home page the look check already holds (#83, #91), so the guard is proven over
 * content this repo already carries and not only a case shaped to fit the fix.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const VIEWPORT_WIDTH = 390;

const FIXTURES = ["viewport-long-token.generated.html", "viewport-baryo-home.generated.html"];

test.describe.configure({ mode: "parallel" });

for (const fixture of FIXTURES) {
    test(`${fixture} lays out inside a ${VIEWPORT_WIDTH}px viewport`, async ({ browser }) => {
        const html = readFileSync(join(here, fixture), "utf8");
        const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: 900 } });
        const page = await context.newPage();
        await page.setContent(html);

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(
            scrollWidth,
            `${fixture} laid out ${scrollWidth}px wide against a ${VIEWPORT_WIDTH}px viewport, so the page scrolls sideways on a phone`,
        ).toBeLessThanOrEqual(VIEWPORT_WIDTH);

        await context.close();
    });
}
