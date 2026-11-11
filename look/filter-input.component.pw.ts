/*
 * A `filterInput` in a real browser (#254).
 *
 * `build-filter-input-fixture.mjs` binds a source holding a bar, a box and rows of two blocks
 * through the compiled package and writes the page with no script and with the box's client code.
 * This types into it, presses keys, and reads what a reader can see. A string match cannot say
 * whether the rule beats a transparent row's inline display, whether a bar's choice and the typed
 * words combine, or whether the box fits 390 pixels; only a browser can.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "filter-input-fixture.generated.json"), "utf8")) as {
    plain: string;
    wired: string;
    rules: Record<string, string>;
};

const ALL = ["row Auth", "row SSO", "row Files", "row Café", "row Mail"];

test.describe.configure({ mode: "parallel" });

async function visibleRows(page: Page): Promise<string[]> {
    return (await page.locator("p:visible", { hasText: /^row / }).allTextContents()).map((t) => t.trim());
}

/** What a click on a bar's button does: its rule goes in beside the bar, inside the source. */
async function chooseValue(page: Page, value: string) {
    const rule = fixture.rules[value];
    await page.evaluate((css) => {
        const group = document.querySelector('[role="group"]')!;
        group.setAttribute("data-bp-filter-value", "x");
        const style = document.createElement("style");
        style.textContent = css;
        group.appendChild(style);
    }, rule);
}

test("shows every row and no box with no script", async ({ page }) => {
    await page.setContent(fixture.plain);

    expect(await visibleRows(page)).toEqual(ALL);
    await expect(page.locator("input[type=search]")).toBeHidden();
});

test("shows the box, labelled, once the script runs, with every row", async ({ page }) => {
    await page.setContent(fixture.wired);

    const box = page.getByRole("searchbox", { name: "Filter" });
    await expect(box).toBeVisible();
    expect(await visibleRows(page)).toEqual(ALL);
    await expect(page.locator("[data-bp-filter-count]")).toHaveText("");
});

test("typing hides rows that lack a word, matching on every block of a row and folding accents", async ({ page }) => {
    await page.setContent(fixture.wired);
    const box = page.getByRole("searchbox", { name: "Filter" });

    await box.fill("sign");
    // The word is in the second block of the Auth and SSO rows, and "Sign in" is Auth's alone.
    expect(await visibleRows(page)).toEqual(["row Auth", "row SSO"]);

    await box.fill("single sign");
    expect(await visibleRows(page)).toEqual(["row SSO"]);

    await box.fill("cafe");
    expect(await visibleRows(page)).toEqual(["row Café"]);

    await box.fill("AUTH tokens");
    expect(await visibleRows(page)).toEqual(["row Auth"]);
});

test("hides every block of a missed row, so no stray text is left", async ({ page }) => {
    await page.setContent(fixture.wired);
    await page.getByRole("searchbox", { name: "Filter" }).fill("mail");

    await expect(page.getByText("about Sends email and chat")).toBeVisible();
    await expect(page.getByText("about Sign in and tokens")).toBeHidden();
    await expect(page.getByText("about Uploads and blobs")).toBeHidden();
});

test("announces the count in a polite live region, and a no-match line", async ({ page }) => {
    await page.setContent(fixture.wired);
    const box = page.getByRole("searchbox", { name: "Filter" });
    const count = page.locator("[data-bp-filter-count]");
    const empty = page.locator("[data-bp-filter-empty]");

    await expect(count).toHaveAttribute("aria-live", "polite");
    await box.fill("sign");
    await expect(count).toHaveText("2 shown");
    await expect(empty).toHaveText("");

    await box.fill("zzz");
    await expect(empty).toHaveText("Nothing matches that.");
    await expect(count).toHaveText("");
    expect(await visibleRows(page)).toEqual([]);

    await box.fill("mail");
    await expect(count).toHaveText("1 shown");
    await expect(empty).toHaveText("");
});

test("Escape clears the box and shows every row again", async ({ page }) => {
    await page.setContent(fixture.wired);
    const box = page.getByRole("searchbox", { name: "Filter" });
    await box.fill("mail");
    expect(await visibleRows(page)).toEqual(["row Mail"]);

    await box.press("Escape");

    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    expect(await visibleRows(page)).toEqual(ALL);
    await expect(page.locator("[data-bp-filter-count]")).toHaveText("");
});

test("slash focuses the box from the page, and a slash typed into another field stays there", async ({ page }) => {
    await page.setContent(`${fixture.wired}<input id="other" type="text">`);
    const box = page.getByRole("searchbox", { name: "Filter" });

    await page.keyboard.press("/");
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("");

    await page.locator("#other").focus();
    await page.keyboard.press("/");
    await expect(page.locator("#other")).toHaveValue("/");
    await expect(page.locator("#other")).toBeFocused();
});

test("combines with the bar's choice: a row needs both", async ({ page }) => {
    await page.setContent(fixture.wired);
    const box = page.getByRole("searchbox", { name: "Filter" });

    await chooseValue(page, "Storage");
    expect(await visibleRows(page)).toEqual(["row Files", "row Café"]);
    await expect(page.locator("[data-bp-filter-count]")).toHaveText("2 shown");

    await box.fill("coffee");
    expect(await visibleRows(page)).toEqual(["row Café"]);
    await expect(page.locator("[data-bp-filter-count]")).toHaveText("1 shown");

    // A word the other chip's rows hold: nothing is left in this one.
    await box.fill("tokens");
    expect(await visibleRows(page)).toEqual([]);
    await expect(page.locator("[data-bp-filter-empty]")).toHaveText("Nothing matches that.");

    await box.press("Escape");
    expect(await visibleRows(page)).toEqual(["row Files", "row Café"]);
});

test("fits a 390 pixel screen with the box inside the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(fixture.wired);
    const box = page.getByRole("searchbox", { name: "Filter" });
    await box.fill("a");

    const rect = await box.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
