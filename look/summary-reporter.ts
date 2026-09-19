/*
 * One table saying how far every page moved.
 *
 * The check has to report each page's difference whether or not the run failed, because a page
 * sitting at four fifths of its threshold is the next failure and nobody sees that in a green tick.
 * The table goes to the console, to summary.md and summary.json in the output directory, and to the
 * job summary when there is one.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { asPercent } from "./compare.js";
import { outputRoot, type LookResult } from "./result.js";

const TITLE = /^(?<id>.+) at (?<width>\d+)px$/;

export default class SummaryReporter implements Reporter {
    private readonly results: LookResult[] = [];

    onTestEnd(test: TestCase, result: TestResult): void {
        const attachment = result.attachments.find((one) => one.name === "look-result");
        if (attachment?.body) {
            this.results.push(JSON.parse(attachment.body.toString("utf8")) as LookResult);
            return;
        }
        const named = TITLE.exec(test.title)?.groups;
        this.results.push({
            id: named?.id ?? test.title,
            width: Number(named?.width ?? 0),
            passed: false,
            diffRatio: Number.NaN,
            maxDiffRatio: Number.NaN,
            diffPixels: 0,
            comparedPixels: 0,
            sizeMismatch: false,
            reference: { width: 0, height: 0 },
            rebuilt: { width: 0, height: 0 },
            missingMasks: [],
            error: result.error?.message ?? `the check did not run (${result.status})`,
        });
    }

    onEnd(run: FullResult): void {
        const ordered = [...this.results].sort((a, b) => a.id.localeCompare(b.id) || a.width - b.width);
        const root = outputRoot();
        mkdirSync(root, { recursive: true });

        const lines = [
            "| Page | Width | Difference | Allowed | Verdict |",
            "| --- | ---: | ---: | ---: | --- |",
            ...ordered.map((one) => {
                const difference = one.error ? "not captured" : asPercent(one.diffRatio);
                const allowed = one.error ? "" : asPercent(one.maxDiffRatio);
                const verdict = one.error ? `error: ${firstLine(one.error)}` : one.passed ? "same" : "different";
                return `| ${one.id} | ${one.width}px | ${difference} | ${allowed} | ${verdict} |`;
            }),
        ];

        const notes: string[] = [];
        for (const one of ordered) {
            for (const mask of one.missingMasks) {
                notes.push(`${one.id} at ${one.width}px: the mask ${mask} matched nothing, so that region was compared.`);
            }
            if (one.sizeMismatch && !one.error) {
                notes.push(
                    `${one.id} at ${one.width}px: the pages are different sizes, reference ${size(one.reference)} and rebuilt ${size(one.rebuilt)}. The area only one of them has counts as different.`,
                );
            }
        }
        if (notes.length > 0) {
            lines.push("", "Worth reading:", ...notes.map((note) => `- ${note}`));
        }

        const markdown = `## Look check\n\n${lines.join("\n")}\n`;
        writeFileSync(join(root, "summary.md"), markdown);
        writeFileSync(join(root, "summary.json"), `${JSON.stringify({ status: run.status, results: ordered }, null, 2)}\n`);
        process.stdout.write(`\n${markdown}\n`);

        if (process.env.GITHUB_STEP_SUMMARY) {
            appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
        }
    }
}

function size(one: { width: number; height: number }): string {
    return `${one.width}x${one.height}`;
}

function firstLine(text: string): string {
    return text.split("\n")[0].slice(0, 120);
}
