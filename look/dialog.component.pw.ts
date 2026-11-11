/*
 * A `dialog` block in a real browser (#254).
 *
 * `build-dialog-fixture.mjs` binds a repeat of dialogs through the compiled package and writes the
 * page with no script and with the block's client code. This opens them, presses keys and clicks
 * the backdrop, and reads where focus is. A string match cannot say whether a modal dialog closes
 * on Escape, hands focus back, keeps Tab inside it, or shows its content with the script off; only
 * a browser can.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "dialog-fixture.generated.json"), "utf8")) as {
    plain: string;
    wired: string;
};

test.describe.configure({ mode: "parallel" });

const trigger = (page: Page, title: string) => page.getByRole("button", { name: `Open ${title}` });
const openPanel = (page: Page) => page.locator("dialog[open]");
const focusedLabel = (page: Page) =>
    page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? (el.getAttribute("data-bp-dialog-close") !== null ? "close" : el.id || el.textContent?.trim() || el.tagName) : "";
    });

test.describe("with no script", () => {
    test.use({ javaScriptEnabled: false });

    test("shows the content of every row in the page, with no trigger and no close button", async ({ page }) => {
        await page.setContent(fixture.plain);

        await expect(page.getByText("about Sign in and tokens")).toBeVisible();
        await expect(page.getByText("about Uploads and blobs")).toBeVisible();
        await expect(page.getByRole("link", { name: "More on Auth" })).toBeVisible();
        await expect(page.locator("[data-bp-dialog-open]")).toHaveCount(2);
        await expect(page.locator("[data-bp-dialog-open]").first()).toBeHidden();
        await expect(page.locator("[data-bp-dialog-close]").first()).toBeHidden();
    });
});

test("with a script, shows the triggers and keeps every dialog closed and its content away", async ({ page }) => {
    await page.setContent(fixture.wired);

    await expect(trigger(page, "Auth")).toBeVisible();
    await expect(trigger(page, "Files")).toBeVisible();
    await expect(openPanel(page)).toHaveCount(0);
    await expect(page.getByText("about Sign in and tokens")).toBeHidden();
});

test("opens as a modal holding that row's own content, named for a screen reader", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Files").click();

    const panel = openPanel(page);
    await expect(panel).toHaveCount(1);
    expect(await panel.evaluate((el) => el.matches(":modal"))).toBe(true);
    await expect(panel).toHaveAttribute("aria-label", "Open Files");
    await expect(panel.getByText("about Uploads and blobs")).toBeVisible();
    await expect(panel.getByText("Sign in and tokens")).toHaveCount(0);
});

test("closes on Escape and gives focus back to the trigger", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Files").click();
    await expect(openPanel(page)).toHaveCount(1);

    await page.keyboard.press("Escape");

    await expect(openPanel(page)).toHaveCount(0);
    await expect(trigger(page, "Files")).toBeFocused();
});

test("closes on the close button, which gets focus first, and gives focus back", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Auth").click();
    await expect(page.locator("dialog[open] [data-bp-dialog-close]")).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(openPanel(page)).toHaveCount(0);
    await expect(trigger(page, "Auth")).toBeFocused();
});

test("closes on a click on the backdrop, not on a click in the panel", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Auth").click();
    await page.getByText("about Sign in and tokens").click();
    await expect(openPanel(page)).toHaveCount(1);

    await page.mouse.click(4, 4);

    await expect(openPanel(page)).toHaveCount(0);
    await expect(trigger(page, "Auth")).toBeFocused();
});

test("a drag that starts in the panel and ends on the backdrop does not close it", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Auth").click();
    const text = await page.getByText("about Sign in and tokens").boundingBox();

    await page.mouse.move(text!.x + 4, text!.y + 4);
    await page.mouse.down();
    await page.mouse.move(4, 4);
    await page.mouse.up();

    await expect(openPanel(page)).toHaveCount(1);
});

test("keeps Tab inside while open, wrapping in both directions, and never reaches the page behind", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Auth").click();
    expect(await focusedLabel(page)).toBe("close");

    await page.keyboard.press("Tab");
    expect(await focusedLabel(page)).toBe("More on Auth");
    await page.keyboard.press("Tab");
    expect(await focusedLabel(page)).toBe("close");
    await page.keyboard.press("Shift+Tab");
    expect(await focusedLabel(page)).toBe("More on Auth");
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(["close", "More on Auth"]).toContain(await focusedLabel(page));
    }
});

test("fades in only when motion is allowed", async ({ page }) => {
    await page.setContent(fixture.wired);
    const animation = () => openPanel(page).evaluate((el) => getComputedStyle(el).animationName);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await trigger(page, "Auth").click();
    expect(await animation()).toBe("bp-dialog-in");
    await page.keyboard.press("Escape");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await trigger(page, "Auth").click();
    expect(await animation()).toBe("none");
    expect(await openPanel(page).evaluate((el) => getComputedStyle(el, "::backdrop").animationName)).toBe("none");
});

test("draws the backdrop from the theme's ink", async ({ page }) => {
    await page.setContent(fixture.wired);
    await trigger(page, "Auth").click();

    const backdrop = await openPanel(page).evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor);
    // Ink #101223 at 55 percent, mixed by the browser from the variable the block set.
    expect(backdrop).toMatch(/^color\(srgb 0\.0627\d* 0\.0705\d* 0\.1372\d* \/ 0\.55\)$|^rgba\(16, 18, 35, 0\.55\)$/);
});

test("fits a 390 pixel screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.setContent(fixture.wired);
    await trigger(page, "Auth").click();

    const rect = await openPanel(page).boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
