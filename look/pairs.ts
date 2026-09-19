/*
 * The pair list, which is data a site owns.
 *
 * A look check compares a reference (the approved design, either a prototype file on disk or the
 * live site being replaced) against the rebuilt page on the stack. Which pages those are is a
 * property of the site, not of this engine, so the list lives in the site's own repository and
 * this file only reads it. Adding a page, or a site, never means editing the job.
 *
 * Unknown keys are refused rather than ignored. A gate whose threshold key was typed `maxDiffratio`
 * would pass everything forever and look healthy doing it.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Just the environment, typed loosely so a test can pass a couple of names and no more. */
export type Env = Record<string, string | undefined>;

export interface MaskSpec {
    /** Selectors masked on both sides. */
    both: string[];
    /** Selectors masked on the reference only, because a prototype's markup is not the site's. */
    reference: string[];
    rebuilt: string[];
}

export type Side = "reference" | "rebuilt";

export interface Target {
    kind: "url" | "file";
    /** An http(s) URL, or an absolute path to a local file. */
    location: string;
    /** Appended to the location, for a prototype whose page states are hash routed. */
    hash?: string;
    /** Clicked in order after load, for a prototype whose page states are tabs. */
    click: string[];
    /** Waited for before the screenshot, on top of the fonts, images and network settling. */
    waitFor?: string;
}

export interface Pair {
    id: string;
    reference: Target;
    rebuilt: Target;
    widths: number[];
    viewportHeight: number;
    fullPage: boolean;
    /** Fraction of compared pixels that may differ, 0 to 1. Above it the pair fails. */
    maxDiffRatio: number;
    /** Per pixel colour distance tolerated before a pixel counts as different, 0 to 1. */
    pixelThreshold: number;
    /** The clock both sides render against, so a rendered date cannot differ between captures. */
    fixedTime: string;
    mask: MaskSpec;
    /** URL globs refused during the capture: analytics, embeds, anything that pulls live content. */
    block: string[];
}

const DEFAULT_WIDTHS = [390, 1280];
const DEFAULT_VIEWPORT_HEIGHT = 900;
const DEFAULT_MAX_DIFF_RATIO = 0.001;
const DEFAULT_PIXEL_THRESHOLD = 0.1;
const DEFAULT_FIXED_TIME = "2026-01-01T09:00:00.000Z";

const DEFAULTS_KEYS = [
    "widths",
    "viewportHeight",
    "fullPage",
    "maxDiffRatio",
    "pixelThreshold",
    "fixedTime",
    "mask",
    "block",
    "referenceBase",
    "rebuiltBase",
] as const;

const PAIR_KEYS = [
    "id",
    "reference",
    "rebuilt",
    "widths",
    "viewportHeight",
    "fullPage",
    "maxDiffRatio",
    "pixelThreshold",
    "fixedTime",
    "mask",
    "block",
] as const;

const TARGET_KEYS = ["url", "file", "hash", "click", "waitFor"] as const;

const MASK_KEYS = ["both", "reference", "rebuilt"] as const;

class Problems {
    readonly messages: string[] = [];

    add(where: string, what: string): void {
        this.messages.push(`${where}: ${what}`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, problems: Problems): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            problems.add(`${where}.${key}`, `unknown key. Known keys are ${allowed.join(", ")}`);
        }
    }
}

function optionalNumber(
    value: unknown,
    where: string,
    problems: Problems,
    fallback: number,
    check: (n: number) => string | null,
): number {
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        problems.add(where, `must be a number, got ${describe(value)}`);
        return fallback;
    }
    const complaint = check(value);
    if (complaint) {
        problems.add(where, complaint);
        return fallback;
    }
    return value;
}

function optionalBoolean(value: unknown, where: string, problems: Problems, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
        problems.add(where, `must be true or false, got ${describe(value)}`);
        return fallback;
    }
    return value;
}

function optionalStrings(value: unknown, where: string, problems: Problems, fallback: string[]): string[] {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        problems.add(where, `must be a list of strings, got ${describe(value)}`);
        return fallback;
    }
    return value as string[];
}

function describe(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "a list";
    return typeof value;
}

/**
 * Expands `${NAME}` against the environment. The rebuilt base is a staging host today and the real
 * one next week, and neither belongs in a file that is reviewed once and kept. An unset name is an
 * error, never an empty string: a base that silently became "" turns every URL into a path and the
 * run fails somewhere far away from the cause.
 */
function expand(value: string, env: Env, where: string, problems: Problems): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
        const found = env[name];
        if (found === undefined || found === "") {
            problems.add(where, `refers to \${${name}}, which is not set in the environment`);
            return "";
        }
        return found;
    });
}

function parseMask(value: unknown, where: string, problems: Problems, fallback: MaskSpec): MaskSpec {
    if (value === undefined) return fallback;
    if (Array.isArray(value)) {
        const both = optionalStrings(value, where, problems, []);
        return { both: [...fallback.both, ...both], reference: fallback.reference, rebuilt: fallback.rebuilt };
    }
    if (!isRecord(value)) {
        problems.add(where, `must be a list of selectors or an object with both, reference and rebuilt`);
        return fallback;
    }
    unknownKeys(value, MASK_KEYS, where, problems);
    return {
        both: [...fallback.both, ...optionalStrings(value.both, `${where}.both`, problems, [])],
        reference: [...fallback.reference, ...optionalStrings(value.reference, `${where}.reference`, problems, [])],
        rebuilt: [...fallback.rebuilt, ...optionalStrings(value.rebuilt, `${where}.rebuilt`, problems, [])],
    };
}

function parseTarget(
    value: unknown,
    where: string,
    problems: Problems,
    context: { baseDir: string; base: string | undefined; env: Env },
): Target {
    const empty: Target = { kind: "url", location: "about:blank", click: [] };
    if (value === undefined) {
        problems.add(where, "is required");
        return empty;
    }
    if (typeof value !== "string" && !isRecord(value)) {
        problems.add(where, `must be a URL, a path, or an object with url or file, got ${describe(value)}`);
        return empty;
    }
    // A bare string is a URL when it is absolute or a path on the side's base, and a file on disk
    // otherwise, so a prototype reads as `"prototypes/Site.dc.html"` and a page as `"/about"`.
    const record: Record<string, unknown> =
        typeof value === "string" ? (/^(https?:\/\/|\/)/i.test(value) ? { url: value } : { file: value }) : value;
    unknownKeys(record, TARGET_KEYS, where, problems);

    const url = record.url;
    const file = record.file;
    if (url !== undefined && file !== undefined) {
        problems.add(where, "has both url and file. A reference is one or the other");
        return empty;
    }
    if (url === undefined && file === undefined) {
        problems.add(where, "needs a url or a file");
        return empty;
    }

    const hash = record.hash === undefined ? undefined : String(record.hash);
    if (record.hash !== undefined && typeof record.hash !== "string") {
        problems.add(`${where}.hash`, `must be a string, got ${describe(record.hash)}`);
    }
    const click = optionalStrings(record.click, `${where}.click`, problems, []);
    const waitFor = record.waitFor === undefined ? undefined : String(record.waitFor);
    if (record.waitFor !== undefined && typeof record.waitFor !== "string") {
        problems.add(`${where}.waitFor`, `must be a string, got ${describe(record.waitFor)}`);
    }

    if (file !== undefined) {
        if (typeof file !== "string") {
            problems.add(`${where}.file`, `must be a path, got ${describe(file)}`);
            return empty;
        }
        const expanded = expand(file, context.env, `${where}.file`, problems);
        const location = isAbsolute(expanded) ? expanded : resolve(context.baseDir, expanded);
        return { kind: "file", location, hash, click, waitFor };
    }

    if (typeof url !== "string") {
        problems.add(`${where}.url`, `must be a URL, got ${describe(url)}`);
        return empty;
    }
    const expanded = expand(url, context.env, `${where}.url`, problems);
    const location = joinBase(expanded, context.base, `${where}.url`, problems);
    return { kind: "url", location, hash, click, waitFor };
}

function joinBase(url: string, base: string | undefined, where: string, problems: Problems): string {
    const absolute = /^https?:\/\//i.test(url);
    if (absolute) return url;
    if (base === undefined) {
        problems.add(
            where,
            `is a path, so it needs a base. Set defaults.${where.includes("reference") ? "referenceBase" : "rebuiltBase"}, or write a full URL`,
        );
        return url;
    }
    try {
        return new URL(url, base.endsWith("/") ? base : `${base}/`).toString();
    } catch {
        problems.add(where, `does not join onto the base ${base}`);
        return url;
    }
}

export interface ParseOptions {
    /** Paths in the file resolve against this, which is the directory the file is in. */
    baseDir: string;
    env?: Env;
}

/** Turns the parsed JSON of a pair list into pairs, or throws one error naming every problem. */
export function parsePairs(raw: unknown, options: ParseOptions): Pair[] {
    const problems = new Problems();
    const env = options.env ?? process.env;

    if (!isRecord(raw)) {
        throw new Error("the pair list must be an object with a pairs list");
    }
    unknownKeys(raw, ["$schema", "defaults", "pairs"], "the pair list", problems);

    const rawDefaults = raw.defaults === undefined ? {} : raw.defaults;
    if (!isRecord(rawDefaults)) {
        throw new Error("defaults: must be an object");
    }
    unknownKeys(rawDefaults, DEFAULTS_KEYS, "defaults", problems);

    const emptyMask: MaskSpec = { both: [], reference: [], rebuilt: [] };
    const defaults = {
        widths: parseWidths(rawDefaults.widths, "defaults.widths", problems, DEFAULT_WIDTHS),
        viewportHeight: optionalNumber(rawDefaults.viewportHeight, "defaults.viewportHeight", problems, DEFAULT_VIEWPORT_HEIGHT, positiveInteger),
        fullPage: optionalBoolean(rawDefaults.fullPage, "defaults.fullPage", problems, true),
        maxDiffRatio: optionalNumber(rawDefaults.maxDiffRatio, "defaults.maxDiffRatio", problems, DEFAULT_MAX_DIFF_RATIO, ratio),
        pixelThreshold: optionalNumber(rawDefaults.pixelThreshold, "defaults.pixelThreshold", problems, DEFAULT_PIXEL_THRESHOLD, ratio),
        fixedTime: parseTime(rawDefaults.fixedTime, "defaults.fixedTime", problems, DEFAULT_FIXED_TIME),
        mask: parseMask(rawDefaults.mask, "defaults.mask", problems, emptyMask),
        block: optionalStrings(rawDefaults.block, "defaults.block", problems, []),
        referenceBase: parseBase(rawDefaults.referenceBase, "defaults.referenceBase", problems, env),
        rebuiltBase: parseBase(rawDefaults.rebuiltBase, "defaults.rebuiltBase", problems, env),
    };

    const rawPairs = raw.pairs;
    if (!Array.isArray(rawPairs) || rawPairs.length === 0) {
        problems.add("pairs", "must be a non-empty list");
        throw new Error(problems.messages.join("\n"));
    }

    const seen = new Set<string>();
    const pairs: Pair[] = [];
    rawPairs.forEach((entry, index) => {
        const where = `pairs[${index}]`;
        if (!isRecord(entry)) {
            problems.add(where, `must be an object, got ${describe(entry)}`);
            return;
        }
        unknownKeys(entry, PAIR_KEYS, where, problems);

        let id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id) {
            problems.add(`${where}.id`, "is required, and names the page in the report and the artifact path");
            id = `pair-${index}`;
        }
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
            problems.add(`${where}.id`, "may hold letters, digits, dots, dashes and underscores only, because it is a directory name");
        }
        if (seen.has(id)) {
            problems.add(`${where}.id`, `is ${id}, which an earlier pair already used`);
        }
        seen.add(id);

        pairs.push({
            id,
            reference: parseTarget(entry.reference, `${where}.reference`, problems, {
                baseDir: options.baseDir,
                base: defaults.referenceBase,
                env,
            }),
            rebuilt: parseTarget(entry.rebuilt, `${where}.rebuilt`, problems, {
                baseDir: options.baseDir,
                base: defaults.rebuiltBase,
                env,
            }),
            widths: parseWidths(entry.widths, `${where}.widths`, problems, defaults.widths),
            viewportHeight: optionalNumber(entry.viewportHeight, `${where}.viewportHeight`, problems, defaults.viewportHeight, positiveInteger),
            fullPage: optionalBoolean(entry.fullPage, `${where}.fullPage`, problems, defaults.fullPage),
            maxDiffRatio: optionalNumber(entry.maxDiffRatio, `${where}.maxDiffRatio`, problems, defaults.maxDiffRatio, ratio),
            pixelThreshold: optionalNumber(entry.pixelThreshold, `${where}.pixelThreshold`, problems, defaults.pixelThreshold, ratio),
            fixedTime: parseTime(entry.fixedTime, `${where}.fixedTime`, problems, defaults.fixedTime),
            mask: parseMask(entry.mask, `${where}.mask`, problems, defaults.mask),
            block: [...defaults.block, ...optionalStrings(entry.block, `${where}.block`, problems, [])],
        });
    });

    if (problems.messages.length > 0) {
        throw new Error(problems.messages.join("\n"));
    }
    return pairs;
}

function parseBase(value: unknown, where: string, problems: Problems, env: Env): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
        problems.add(where, `must be a URL, got ${describe(value)}`);
        return undefined;
    }
    const expanded = expand(value, env, where, problems);
    if (expanded && !/^https?:\/\//i.test(expanded)) {
        problems.add(where, `must start with http:// or https://, got ${expanded}`);
        return undefined;
    }
    return expanded || undefined;
}

function parseWidths(value: unknown, where: string, problems: Problems, fallback: number[]): number[] {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.length === 0) {
        problems.add(where, "must be a non-empty list of pixel widths");
        return fallback;
    }
    const widths: number[] = [];
    value.forEach((entry, index) => {
        if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 200 || entry > 4000) {
            problems.add(`${where}[${index}]`, `must be a whole number of pixels between 200 and 4000, got ${describe(entry)}`);
            return;
        }
        widths.push(entry);
    });
    return widths.length > 0 ? widths : fallback;
}

function parseTime(value: unknown, where: string, problems: Problems, fallback: string): string {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        problems.add(where, `must be a date and time the browser can be pinned to, such as 2026-01-01T09:00:00Z, got ${describe(value)}`);
        return fallback;
    }
    return value;
}

function positiveInteger(n: number): string | null {
    return Number.isInteger(n) && n > 0 ? null : "must be a whole number above zero";
}

function ratio(n: number): string | null {
    return n >= 0 && n <= 1 ? null : "must be between 0 and 1, where 0.001 is a tenth of one percent of the pixels";
}

/** Reads a pair list from disk. Paths inside it resolve against the file's own directory. */
export function loadPairs(file: string, env: Env = process.env): Pair[] {
    const path = resolve(file);
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (error) {
        throw new Error(`cannot read the pair list at ${path}: ${(error as Error).message}`);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
    }
    try {
        return parsePairs(raw, { baseDir: dirname(path), env });
    } catch (error) {
        throw new Error(`${path} is not a usable pair list.\n${(error as Error).message}`);
    }
}

/** The address Playwright navigates to, which for a prototype on disk is a file URL. */
export function addressOf(target: Target): string {
    const base = target.kind === "file" ? pathToFileURL(target.location).toString() : target.location;
    if (!target.hash) return base;
    const hash = target.hash.startsWith("#") ? target.hash : `#${target.hash}`;
    return `${base.split("#")[0]}${hash}`;
}

/** The selectors masked on one side: what is global plus what that side needs. */
export function masksFor(pair: Pair, side: Side): string[] {
    return [...pair.mask.both, ...pair.mask[side]];
}
