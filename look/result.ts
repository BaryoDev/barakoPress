/* What one page at one width produced, shared by the check and the reporter that summarises it. */

import { resolve } from "node:path";

import type { Size } from "./compare.js";
import type { Env } from "./pairs.js";

export interface LookResult {
    id: string;
    width: number;
    passed: boolean;
    diffRatio: number;
    maxDiffRatio: number;
    diffPixels: number;
    comparedPixels: number;
    sizeMismatch: boolean;
    reference: Size;
    rebuilt: Size;
    /** Mask selectors that matched nothing, listed per side as "reference: .news-feed". */
    missingMasks: string[];
    /** Set when the capture never happened: the page did not load, a selector never appeared. */
    error?: string;
}

/** Everything a run writes goes under here, and this is the directory CI uploads. */
export function outputRoot(env: Env = process.env): string {
    return resolve(env.LOOK_OUTPUT ?? "look-results");
}

export function pageDir(id: string, width: number, env: Env = process.env): string {
    return resolve(outputRoot(env), "pages", id, String(width));
}
