/*
 * The disclosure and the faq built on it, in a real browser (#235).
 *
 * `build-disclosure-fixture.mjs` renders a faq of three items through the compiled package: one
 * group, the second item starting open, a link in every answer. A string match on the markup cannot
 * say whether a keyboard user gets through it, whether `<details name>` closes the other item, or
 * whether the motion rules step aside for a reduced-motion visitor. A browser can.
 *
 * Find-in-page revealing a match inside a closed answer is not checked here. Chromium expands a
 * closed `<details>` when the browser's own find bar matches inside it, but Playwright cannot
 * drive that bar, and `window.find` is not the same code path, so a test built on it would pass or
 * fail for reasons that say nothing about this block. The markup check in motion.test.tsx covers
 * the part the block controls: the answer stays in the page when closed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "disclosure-fixture.generated.json"), "utf8")) as { page: string };

const item = (page: Page, name: string) => page.locator("details[data-bp-disclosure]", { hasText: `Question ${name}` });
const openOnes = (page: Page) =>
    page.evaluate(() =>
        [...document.querySelectorAll<HTMLDetailsElement>("details[data-bp-disclosure][open]")].map(
            (d) => d.querySelector("summary")!.textContent,
        ),
    );
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");

test("opens the item that starts open and no other", async ({ page }) => {
    await page.setContent(fixture.page);

    expect(await openOnes(page)).toEqual(["Question B"]);
    await expect(page.getByText("Answer B has a zebrafish")).toBeVisible();
});

test("opening one item in the group closes the one that was open", async ({ page }) => {
    await page.setContent(fixture.page);

    await item(page, "C").locator("summary").click();
    expect(await openOnes(page)).toEqual(["Question C"]);

    await item(page, "A").locator("summary").click();
    expect(await openOnes(page)).toEqual(["Question A"]);
});

test("a keyboard user tabs to a summary, opens it with Enter or Space, and tabs on to the link in its answer", async ({ page }) => {
    await page.setContent(fixture.page);

    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Question A");
    await page.keyboard.press("Enter");
    await expect(item(page, "A")).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Link A");

    // The next stop is the summary of B, which the open A has just closed.
    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Question B");
    await page.keyboard.press("Space");
    await expect(item(page, "B")).toHaveAttribute("open", "");
    expect(await openOnes(page)).toEqual(["Question B"]);
    await page.keyboard.press("Tab");
    expect(await focusedText(page)).toBe("Link B");
});

test("a closed answer's link is not a tab stop until its item opens", async ({ page }) => {
    await page.setContent(fixture.page);
    await item(page, "A").locator("summary").focus();

    await page.keyboard.press("Tab");

    expect(await focusedText(page)).toBe("Question B");
});

test("draws the open and close motion when it is allowed and none when reduced motion is asked for", async ({ page }) => {
    await page.setContent(fixture.page);
    const supported = await page.evaluate(() => CSS.supports("selector(::details-content)"));
    // The rules sit under @supports, so a browser without ::details-content has none to check.
    test.skip(!supported, "this browser has no ::details-content");

    const motion = () =>
        item(page, "B").evaluate((el) => {
            const content = getComputedStyle(el, "::details-content");
            const panel = getComputedStyle(el.querySelector("[data-bp-panel]")!);
            return { display: content.display, transition: content.transitionDuration, overflow: panel.overflow };
        });

    await page.emulateMedia({ reducedMotion: "no-preference" });
    const moving = await motion();
    expect(moving.display).toBe("grid");
    expect(moving.transition).toContain("0.4s");
    expect(moving.overflow).toBe("clip");

    await page.emulateMedia({ reducedMotion: "reduce" });
    const still = await motion();
    expect(still.display).not.toBe("grid");
    expect(still.transition).toBe("0s");
    expect(still.overflow).toBe("visible");
});
