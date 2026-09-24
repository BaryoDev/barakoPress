/*
 * The tree screens a site can style (barakoPress #130), in a real browser.
 *
 * The unit tests prove the markup carries a token and a class on each part. What they cannot prove
 * is that a token set on the root reaches the part it names once CSS has resolved it, or that a
 * variant lays out the way it says at a laptop width and at a phone width. That is this file.
 *
 * `build-tree-fixtures.mjs` renders the item page through the real compiled package: once with
 * nothing set, once under a stylesheet naming a token of each kind, and once with every variant and
 * the tokens barakocms.com's docs are drawn with.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, `tree-${name}.generated.html`), "utf8");

test.describe.configure({ mode: "parallel" });

async function open(browser: import("@playwright/test").Browser, name: string, width: number, javaScriptEnabled = false) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled });
    const page = await context.newPage();
    await page.setContent(fixture(name));
    return { context, page };
}

const css = (page: Page, selector: string, property: string) =>
    page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test("a site that sets no token gets the theme's own values", async ({ browser }) => {
    const { context, page } = await open(browser, "default", 1280);
    expect(await css(page, ".bp-tree-link-current", "background-color")).toBe("rgb(238, 235, 253)");
    expect(await css(page, ".bp-tree-link-current", "font-weight")).toBe("600");
    expect(await css(page, ".bp-tree-link", "border-radius")).toBe("11px");
    expect(await css(page, ".bp-tree-sections", "row-gap")).toBe("20px");
    expect(await css(page, ".bp-tree-tab-current", "background-color")).toBe("rgb(90, 70, 214)");
    expect(await css(page, ".bp-tree-pager-link", "border-top-left-radius")).toBe("14px");
    await context.close();
});

test("a token set on the root reaches the part it names", async ({ browser }) => {
    const { context, page } = await open(browser, "tokened", 1280);
    expect(await css(page, ".bp-tree-link-current", "background-color")).toBe("rgb(18, 52, 86)");
    expect(await css(page, ".bp-tree-link-current", "color")).toBe("rgb(250, 240, 230)");
    expect(await css(page, ".bp-tree-link-current", "font-weight")).toBe("800");
    expect(await css(page, ".bp-tree-link", "border-radius")).toBe("3px");
    expect(await css(page, ".bp-tree-link", "font-size")).toBe("19px");
    expect(await css(page, ".bp-tree-sections", "row-gap")).toBe("37px");
    expect(await css(page, ".bp-tree-tab-current", "background-color")).toBe("rgb(10, 120, 30)");
    expect(await css(page, ".bp-tree-pager-link", "border-top-left-radius")).toBe("21px");
    await context.close();
});

test("the designed variants lay out as barakocms.com's docs do at a laptop width", async ({ browser }) => {
    const { context, page } = await open(browser, "designed", 1280);
    const aside = await page.locator(".bp-tree-aside").boundingBox();
    const body = await page.locator(".bp-tree-body").boundingBox();
    const rail = await page.locator(".bp-tree-rail").boundingBox();
    if (!aside || !body || !rail) throw new Error("a column of the shell did not lay out");

    // Three columns edge to edge: 280, the rest, 250.
    expect(aside.x).toBe(0);
    expect(aside.width).toBe(280);
    expect(body.x).toBe(280);
    expect(rail.width).toBe(250);
    expect(rail.x + rail.width).toBe(1280);
    expect(body.width).toBe(1280 - 280 - 250);
    expect(aside.height).toBeGreaterThanOrEqual(1000);

    // The products are a column inside the sidebar, under the search box and above the sections.
    const products = page.locator(".bp-tree-product");
    await expect(products).toHaveCount(3);
    const boxes = await Promise.all([0, 1, 2].map((i) => products.nth(i).boundingBox()));
    for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i]!.x).toBe(boxes[0]!.x);
        expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y);
    }
    const search = await page.locator(".bp-tree-search").boundingBox();
    const sections = await page.locator(".bp-tree-sections").boundingBox();
    expect(search!.y).toBeLessThan(boxes[0]!.y);
    expect(boxes[2]!.y).toBeLessThan(sections!.y);

    // The rail lists the page's headings.
    await expect(page.locator(".bp-tree-rail-link")).toHaveText(["Install the package", "Configure the site", "Deploy"]);

    // The pager's first half is held empty, so next sits on the right rather than across the row.
    const next = await page.locator(".bp-tree-pager-next").boundingBox();
    const empty = await page.locator(".bp-tree-pager-empty").boundingBox();
    const pager = await page.locator(".bp-tree-pager").boundingBox();
    expect(empty!.width).toBeGreaterThan(pager!.width / 3);
    expect(next!.x).toBeGreaterThan(empty!.x + empty!.width);
    expect(next!.x + next!.width).toBe(pager!.x + pager!.width);
    await context.close();
});

test("the closed disclosure is shut on a phone, names the page, and opens with a tap", async ({ browser }) => {
    const { context, page } = await open(browser, "designed", 390);
    const summary = page.locator(".bp-tree-summary");
    await expect(summary).toBeVisible();
    await expect(page.locator(".bp-tree-summary-group")).toHaveText("barakoCMS / Getting started");
    await expect(page.locator(".bp-tree-summary-title")).toHaveText("Quickstart");
    await expect(page.locator(".bp-tree-summary-show")).toBeVisible();
    await expect(page.locator(".bp-tree-sections")).toBeHidden();

    await summary.click();
    await expect(page.locator(".bp-tree-sections")).toBeVisible();
    await expect(page.locator(".bp-tree-summary-hide")).toHaveText("Close");
    await expect(page.locator(".bp-tree-summary-show")).toBeHidden();
    expect(await css(page, ".bp-tree-summary-chevron", "transform")).not.toBe("none");
    await context.close();
});

test("the closed disclosure shows the whole sidebar above a phone, with no control and no script", async ({ browser }) => {
    const { context, page } = await open(browser, "designed", 1280);
    expect(await page.locator("details.bp-tree-sidebar").getAttribute("open")).toBeNull();
    await expect(page.locator(".bp-tree-summary")).toBeHidden();
    await expect(page.locator(".bp-tree-sections")).toBeVisible();
    await expect(page.locator(".bp-tree-product")).toHaveCount(3);
    await context.close();
});

test("the compact search box is one well, named for a screen reader, with its results floating", async ({ browser }) => {
    const { context, page } = await open(browser, "designed", 1280, true);
    await expect(page.locator(".bp-tree-search-label")).toHaveCount(0);
    const input = page.getByRole("searchbox", { name: "Search the docs" });
    await expect(input).toBeVisible();
    const well = await page.locator(".bp-tree-search-box").boundingBox();
    const icon = await page.locator(".bp-tree-search-icon").boundingBox();
    const key = await page.locator(".bp-tree-search-key").boundingBox();
    expect(well!.height).toBe(36);
    expect(icon!.x).toBeLessThan(key!.x);
    expect(await css(page, ".bp-tree-search-box", "background-color")).toBe("rgb(242, 243, 249)");

    // The panel covers what follows rather than pushing it down.
    const before = await page.locator(".bp-tree-sections").boundingBox();
    await input.fill("install");
    await expect(page.locator("[data-bp-search-index]")).toBeVisible();
    expect(await css(page, "[data-bp-search-index]", "position")).toBe("absolute");
    const after = await page.locator(".bp-tree-sections").boundingBox();
    expect(after!.y).toBe(before!.y);

    await input.fill("nothing like this");
    await expect(page.locator("[data-bp-search-empty]")).toHaveText('Nothing matches "nothing like this".');
    await context.close();
});

test("the designed variants stack on a phone and give the rail's room back", async ({ browser }) => {
    const { context, page } = await open(browser, "designed", 390);
    await expect(page.locator(".bp-tree-rail")).toBeHidden();
    const aside = await page.locator(".bp-tree-aside").boundingBox();
    const body = await page.locator(".bp-tree-body").boundingBox();
    expect(aside!.width).toBe(390);
    expect(body!.y).toBeGreaterThanOrEqual(aside!.y + aside!.height);
    expect(await css(page, ".bp-tree-aside", "border-right-width")).toBe("0px");
    expect(await css(page, ".bp-tree-aside", "border-bottom-width")).toBe("1px");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBe(390);
    await context.close();
});

test("the in-page index shows what matches as the reader types, and says so when nothing does", async ({ browser }) => {
    const { context, page } = await open(browser, "designed", 1280, true);
    const index = page.locator("[data-bp-search-index]");
    await expect(index).toBeHidden();

    await page.locator('input[type="search"]').fill("configure");
    await expect(index).toBeVisible();
    const hits = page.locator("[data-bp-search-index] .bp-tree-search-hit:visible");
    await expect(hits).toHaveCount(1);
    await expect(hits.first()).toHaveAttribute("href", "/docs/quickstart#configure-the-site");
    await expect(page.locator("[data-bp-search-empty]")).toBeHidden();

    // Every word has to match, in any order, across the heading and its page.
    await page.locator('input[type="search"]').fill("paging public");
    await expect(hits).toHaveCount(1);
    await expect(hits.first()).toHaveAttribute("href", "/docs/delivery#paging");

    await page.locator('input[type="search"]').fill("nothing like this");
    await expect(hits).toHaveCount(0);
    await expect(page.locator("[data-bp-search-empty]")).toBeVisible();

    await page.locator('input[type="search"]').fill("");
    await expect(index).toBeHidden();
    await context.close();
});
