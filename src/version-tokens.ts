import type { PressConfig } from "./config.js";
import { versionText } from "./versions.js";

/*
 * `{cms.Version}` style tokens in `richText` (#232). Which names exist, and the package each one
 * means, is `synced.tokens` in the config. A name that is not configured is left as typed.
 *
 * Only prose is touched. A token inside a fenced block, a code span, a link or image destination,
 * an autolink or a reference definition stays as written, so a docs page can show the syntax.
 * `\{name}` renders as the literal `{name}`, and `{{...}}` is a binding and is never read here.
 *
 * A configured token with no value yet, a registry that was down with no snapshot, is dropped
 * rather than printed, so a page never says "undefined" or shows a bare token.
 *
 * Limits: a fence inside a blockquote or list item, and an indented code block, are read as prose.
 * Markdown past MAX_MARKDOWN characters is returned unchanged.
 */

const TOKEN = /^\{([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)\}/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DEFINITION = /^ {0,3}\[[^\]]+\]:/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
/** The longest token name looked at, so a line of braces is not re-read in full at each one. */
const MAX_NAME = 200;

type Part = string | { token: string };

/** Past this the text is returned as it came: a scan that long is not a page of prose, and the cost is capped. */
export const MAX_MARKDOWN = 100_000;

/**
 * Finds the next closer from a position, and remembers the answer. A miss means nothing closes
 * from there on, and a hit is reused while the position is before it, so a line of openers
 * costs one search and not one per opener.
 */
function finder(find: (from: number) => number): (from: number) => number {
    let none = Infinity;
    let hitFrom = -1;
    let hit = -1;
    return (from) => {
        if (from >= none) return -1;
        if (hit >= from && hitFrom <= from) return hit;
        const at = find(from);
        if (at === -1) none = Math.min(none, from);
        else {
            hitFrom = from;
            hit = at;
        }
        return at;
    };
}

/** The start of the next run of exactly `n` backticks at or after `from`. */
function runOf(line: string, n: number, from: number): number {
    let p = line.indexOf("`", from);
    while (p !== -1) {
        let m = 1;
        while (line[p + m] === "`") m++;
        if (m === n) return p;
        p = line.indexOf("`", p + m);
    }
    return -1;
}

/** The markdown cut into text to keep and the configured tokens to fill. */
function parts(config: PressConfig, markdown: string): Part[] {
    const out: Part[] = [];
    let keep = "";
    const flush = () => {
        if (keep) out.push(keep);
        keep = "";
    };

    let fence: string | null = null;
    for (const line of markdown.split("\n")) {
        const open = FENCE.exec(line);
        if (fence !== null) {
            keep += `${line}\n`;
            if (open && open[1]![0] === fence[0] && open[1]!.length >= fence.length && line.trim() === open[1]) fence = null;
            continue;
        }
        // A backtick fence may not have a backtick after it, so ```code``` on one line is a span.
        if (open && !(open[1]![0] === "`" && line.includes("`", open[0].length))) {
            fence = open[1]!;
            keep += `${line}\n`;
            continue;
        }
        if (DEFINITION.test(line)) {
            keep += `${line}\n`;
            continue;
        }

        const closers = new Map<number, (from: number) => number>();
        const closeRun = (n: number, from: number) => {
            let next = closers.get(n);
            if (!next) closers.set(n, (next = finder((f) => runOf(line, n, f))));
            return next(from);
        };
        const closeAngle = finder((f) => line.indexOf(">", f));
        const closeBraces = finder((f) => line.indexOf("}}", f));

        for (let i = 0; i < line.length; ) {
            const c = line[i]!;
            if (c === "`") {
                // A span closes on a run of the same length. With none, the backticks are plain.
                let n = 1;
                while (line[i + n] === "`") n++;
                const close = closeRun(n, i + n);
                const end = close === -1 ? i + n : close + n;
                keep += line.slice(i, end);
                i = end;
            } else if (c === "<") {
                const close = closeAngle(i);
                const inner = close === -1 ? "" : line.slice(i + 1, close);
                if (/^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(inner)) {
                    keep += line.slice(i, close + 1);
                    i = close + 1;
                } else {
                    keep += c;
                    i++;
                }
            } else if (c === "]" && line[i + 1] === "(") {
                // A link or image destination, to its closing parenthesis.
                let depth = 0;
                let j = i + 1;
                for (; j < line.length; j++) {
                    if (line[j] === "\\") j++;
                    else if (line[j] === "(") depth++;
                    else if (line[j] === ")" && --depth === 0) break;
                }
                keep += line.slice(i, j + 1);
                i = j + 1;
            } else if (c === "\\") {
                const next = line[i + 1];
                const escaped = next === "{" ? TOKEN.exec(line.slice(i + 1)) : null;
                if (escaped) {
                    // `\{name}` shows the braces as text.
                    keep += escaped[0];
                    i += 1 + escaped[0].length;
                } else if (next !== undefined && next !== "{" && PUNCTUATION.test(next)) {
                    // Any other escaped mark, a backtick or a backslash, is taken as a pair.
                    keep += c + next;
                    i += 2;
                } else {
                    keep += c;
                    i++;
                }
            } else if (c === "{" && line[i + 1] === "{") {
                const close = closeBraces(i + 2);
                const end = close === -1 ? i + 2 : close + 2;
                keep += line.slice(i, end);
                i = end;
            } else if (c === "{") {
                const found = TOKEN.exec(line.slice(i, i + MAX_NAME));
                if (found && Object.hasOwn(config.synced.tokens, found[1]!)) {
                    flush();
                    out.push({ token: found[1]! });
                } else {
                    keep += found ? found[0] : c;
                }
                i += found ? found[0].length : 1;
            } else {
                keep += c;
                i++;
            }
        }
        keep += "\n";
    }
    flush();
    // A newline went after every line, including the last, which had none.
    const last = out.length - 1;
    if (typeof out[last] === "string") out[last] = out[last]!.slice(0, -1);
    return out;
}

/** A value goes into markdown as text, so what markdown would read as syntax is escaped. */
function asText(value: string): string {
    return value.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");
}

export function namesToken(config: PressConfig, markdown: string): boolean {
    if (typeof markdown !== "string" || markdown.length > MAX_MARKDOWN || !markdown.includes("{")) return false;
    return parts(config, markdown).some((part) => typeof part !== "string");
}

export async function withVersionTokens(config: PressConfig, markdown: string): Promise<string> {
    if (typeof markdown !== "string" || markdown.length > MAX_MARKDOWN) return markdown;
    const found = parts(config, markdown);
    const values = new Map<string, string>();
    await Promise.all(
        [...new Set(found.flatMap((part) => (typeof part === "string" ? [] : [part.token])))].map(async (name) => {
            values.set(name, asText((await versionText(config, name)) ?? ""));
        }),
    );
    return found.map((part) => (typeof part === "string" ? part : values.get(part.token)!)).join("");
}
