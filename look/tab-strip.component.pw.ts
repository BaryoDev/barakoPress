/*
 * A tab strip that works past two tabs (barakoPress #91, and a fix to what shipped on master with
 * the blocker still live).
 *
 * The first `tabGroup`/`tabPanel` built on `<details style="display:contents">`, the same trick
 * `stickyBar` uses to escape the wrapper `BlockList` puts around a block. It rendered right with two
 * tabs and broke past two: the third and fourth summaries landed beside or behind the open panel
 * instead of in the row above it, because `<details>`'s own native show-and-hide does not survive
 * being promoted more than once into the same flex context. That version is what shipped, because
 * this fix landed after the pull request that carried it was merged. Reading the diff would not
 * have caught it: `order` on a plain promoted `div` kept working the whole time, and the compiled
 * markup looked exactly as intended. Only rendering it in a real browser found it, and a report of
 * that is not a gate, so this is the gate.
 *
 * `build-tab-strip-fixture.mjs` renders the exact four-tab shape `codeTabs` compiles the baryo.dev
 * fixture's install band into (one primary, one `primaryLabel`, three `codeTab`s) through the real,
 * compiled package, and writes it as one static file this test loads with no React or `next/*`
 * import of its own: `page.setContent` needs a string, and the string is already the real answer.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "tab-strip-fixture.generated.html"), "utf8");

// Kept in step with build-tab-strip-fixture.mjs's own constants rather than re-imported, since that
// file runs as plain Node against dist and this one runs through Playwright's own transform.
const LABELS = ["barakoCMS", "barakoBrew", "barakoPress", "BaryoVM"];
const PRIMARY_CODE = "dotnet add package BarakoCMS";
const LAST_TAB_CODE = "dotnet tool install -g BaryoVM";

test.describe.configure({ mode: "parallel" });

test("draws every tab button in one row, above the open panel, four tabs deep", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setContent(html);

    const labels = page.locator("label[data-bp-tabbtn]");
    await expect(labels).toHaveCount(LABELS.length);
    for (let i = 0; i < LABELS.length; i++) {
        await expect(labels.nth(i)).toHaveText(LABELS[i]);
    }

    const boxes = [];
    for (let i = 0; i < LABELS.length; i++) {
        const box = await labels.nth(i).boundingBox();
        if (!box) throw new Error(`tab "${LABELS[i]}" has no box, so it did not lay out at all`);
        boxes.push(box);
    }

    // One row: this is what broke on <details>, where the third and fourth summaries dropped out
    // of the strip's own row once a panel opened between them and the first two.
    for (const box of boxes.slice(1)) {
        expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(2);
    }
    // Side by side and in order, not stacked or overlapping.
    for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
    }

    const panel = page.locator("[data-bp-tabpanel]:visible");
    await expect(panel).toHaveCount(1);
    const panelBox = await panel.boundingBox();
    if (!panelBox) throw new Error("the open panel has no box");
    // Below the whole strip: the other half of what broke, where the panel rendered beside or over
    // the later buttons instead of under all four of them.
    for (const box of boxes) expect(panelBox.y).toBeGreaterThanOrEqual(box.y + box.height - 1);

    await context.close();
});

test("switches which panel is visible on a click, with JavaScript off", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setContent(html);

    await expect(page.locator("[data-bp-tabpanel]:visible")).toHaveCount(1);
    await expect(page.locator("[data-bp-tabpanel]:visible")).toContainText(PRIMARY_CODE);

    await page.locator("label", { hasText: "BaryoVM" }).click();

    const visible = page.locator("[data-bp-tabpanel]:visible");
    await expect(visible).toHaveCount(1);
    await expect(visible).toContainText(LAST_TAB_CODE);
    await expect(visible).not.toContainText(PRIMARY_CODE);

    await context.close();
});
