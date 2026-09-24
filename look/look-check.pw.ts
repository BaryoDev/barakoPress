/*
 * The look check: one test per page per width, each one capturing both sides and comparing them.
 *
 * The pages are not in this file. LOOK_PAIRS names a pair list the site owns, and the tests are
 * built from it, so adding a page or a whole site never means editing the job.
 *
 * Both captures happen inside the test, seconds apart, in two fresh contexts. Comparing a stored
 * baseline would be a different check: it would tell you the rebuilt site changed since yesterday,
 * not that it matches the design that was approved.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { capture } from "./capture.js";
import { asPercent, comparePngs } from "./compare.js";
import { loadPairs, masksFor } from "./pairs.js";
import { pageDir, type LookResult } from "./result.js";

const pairsFile = process.env.LOOK_PAIRS;
if (!pairsFile) {
    throw new Error("LOOK_PAIRS is not set. Point it at the pair list, which lives with the site's data.");
}

const pairs = loadPairs(pairsFile);

test.describe.configure({ mode: "parallel" });

for (const pair of pairs) {
    for (const width of pair.widths) {
        test(`${pair.id} at ${width}px`, async ({ browser }, testInfo) => {
            // `timeout` bounds each step of a capture (load, wait, screenshot), not the capture, and
            // there are two captures: six steps, and room for the settle and the comparison.
            test.setTimeout(Math.max(testInfo.timeout, pair.timeout * 6 + 30_000));
            const options = {
                timeout: pair.timeout,
                width,
                viewportHeight: pair.viewportHeight,
                fullPage: pair.fullPage,
                fixedTime: pair.fixedTime,
                block: pair.block,
            };
            const reference = await capture(browser, pair.reference, {
                ...options,
                mask: masksFor(pair, "reference"),
            });
            const rebuilt = await capture(browser, pair.rebuilt, {
                ...options,
                mask: masksFor(pair, "rebuilt"),
            });

            const { comparison, diff } = comparePngs(reference.png, rebuilt.png, {
                pixelThreshold: pair.pixelThreshold,
            });
            const passed = comparison.diffRatio <= pair.maxDiffRatio;

            const directory = pageDir(pair.id, width);
            mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, "reference.png"), reference.png);
            writeFileSync(join(directory, "rebuilt.png"), rebuilt.png);
            writeFileSync(join(directory, "diff.png"), diff);

            const result: LookResult = {
                id: pair.id,
                width,
                passed,
                diffRatio: comparison.diffRatio,
                maxDiffRatio: pair.maxDiffRatio,
                diffPixels: comparison.diffPixels,
                comparedPixels: comparison.comparedPixels,
                sizeMismatch: comparison.sizeMismatch,
                reference: comparison.reference,
                rebuilt: comparison.rebuilt,
                missingMasks: [
                    ...reference.missingMasks.map((selector) => `reference: ${selector}`),
                    ...rebuilt.missingMasks.map((selector) => `rebuilt: ${selector}`),
                ],
            };
            await testInfo.attach("look-result", {
                body: JSON.stringify(result),
                contentType: "application/json",
            });

            // A number alone does not tell anyone what moved, so the three images travel with the
            // failure. On a pass they stay on disk and are not attached, because nine green pages
            // at two widths is fifty-four images nobody opens.
            if (!passed) {
                await testInfo.attach("reference", { path: join(directory, "reference.png"), contentType: "image/png" });
                await testInfo.attach("rebuilt", { path: join(directory, "rebuilt.png"), contentType: "image/png" });
                await testInfo.attach("diff", { path: join(directory, "diff.png"), contentType: "image/png" });
            }

            const sizes = comparison.sizeMismatch
                ? ` The pages are different sizes: reference ${comparison.reference.width}x${comparison.reference.height}, rebuilt ${comparison.rebuilt.width}x${comparison.rebuilt.height}.`
                : "";
            expect(
                comparison.diffRatio,
                `${pair.id} at ${width}px differs by ${asPercent(comparison.diffRatio)} of its pixels (${comparison.diffPixels} of ${comparison.comparedPixels}), over the ${asPercent(pair.maxDiffRatio)} this page allows.${sizes} The images are in ${directory}.`,
            ).toBeLessThanOrEqual(pair.maxDiffRatio);
        });
    }
}
