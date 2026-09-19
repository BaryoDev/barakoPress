/*
 * The look check's own Playwright config, separate from anything else this repository runs.
 *
 * Chromium only, and one browser is the point rather than a shortcut. The check asks whether the
 * rebuilt page matches the approved design, and both sides are captured by the same engine in the
 * same run, so a second engine adds cost and a second set of font rendering differences without
 * answering a new question. Cross browser rendering is a different check with a different name.
 *
 * No retries. A retry on a look check hides exactly the flake that has to be found and fixed, and
 * a gate that passes on the second go is not a gate.
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import { outputRoot } from "./result.js";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    testDir: here,
    testMatch: /look-check\.pw\.ts$/,
    outputDir: `${outputRoot()}/playwright`,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 0,
    // Two captures a test, each a whole page render. More workers than the machine has cores turns
    // into slower captures and, on a page with any timing in it, a difference that is not real.
    workers: Number(process.env.LOOK_WORKERS ?? 2),
    reporter: [["list"], ["./summary-reporter.ts"]],
    timeout: 120_000,
    expect: { timeout: 10_000 },
    projects: [{ name: "look", use: { browserName: "chromium" } }],
});
