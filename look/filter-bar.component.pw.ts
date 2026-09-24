/*
 * The rule a `filterBar` writes, in a real browser (#129).
 *
 * `build-filter-bar-fixture.mjs` binds a source with a bar through the compiled package and writes
 * the page at rest and the rule for each value. This loads the page, adds one rule the way the bar
 * does on a click, and reads which rows a reader can see. A string match on the rule cannot say
 * whether it beats the inline `display: contents` on a transparent row, or whether a value with
 * quotes still selects its own rows; only a browser can.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "filter-bar-fixture.generated.json"), "utf8")) as {
    html: string;
    rules: Record<string, string>;
};

// Kept in step with build-filter-bar-fixture.mjs.
const HOSTILE = `Ops "&" </style> tools`;

test.describe.configure({ mode: "parallel" });

async function visibleRows(page: import("@playwright/test").Page): Promise<string[]> {
    return (await page.locator("p:visible", { hasText: /^row / }).allTextContents()).map((t) => t.trim());
}

test("shows every row at rest", async ({ page }) => {
    await page.setContent(fixture.html);

    expect(await visibleRows(page)).toEqual(["row Auth", "row SSO", "row Files", "row Metrics", "row Mail"]);
});

test("offers one button per value, after the all button, each with aria-pressed", async ({ page }) => {
    await page.setContent(fixture.html);

    const buttons = page.locator('[role="group"] button');
    await expect(buttons).toHaveText(["All", "Auth", "Storage", HOSTILE, "Mail and chat"]);
    await expect(buttons.first()).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "false");
});

for (const [value, rows] of [
    ["Auth", ["row Auth", "row SSO"]],
    ["Storage", ["row Files"]],
    [HOSTILE, ["row Metrics"]],
    ["Mail and chat", ["row Mail"]],
] as const) {
    test(`shows only the rows holding ${JSON.stringify(value)}, over the rows' inline display`, async ({ page }) => {
        await page.setContent(fixture.html);
        const rule = fixture.rules[value];
        expect(rule).toBeTruthy();
        await page.addStyleTag({ content: rule });

        expect(await visibleRows(page)).toEqual([...rows]);
        // The bar itself is never one of the rows.
        await expect(page.locator('[role="group"]')).toBeVisible();
    });
}
