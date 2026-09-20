/*
 * Playwright config for a block's own rendered markup, not a page against a design.
 *
 * Separate from `playwright.look.config.ts` on purpose: that one is a pair list read from
 * `LOOK_PAIRS` and its own reporter summarises a pair's diff ratio, neither of which a component
 * test has. This one is plain Playwright over whatever `*.component.pw.ts` files exist, each
 * building its own markup with the real renderer and asserting on it in a real browser rather than
 * on a string a screenshot could still contradict.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    testDir: here,
    testMatch: /\.component\.pw\.ts$/,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    reporter: [["list"]],
    projects: [{ name: "component", use: { browserName: "chromium" } }],
});
