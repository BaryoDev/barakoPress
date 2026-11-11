/*
 * The filter a `filterBar` draws over the rows of the `source` around it (#129).
 *
 * The rows stay server-rendered. The binder marks each one with the bar it belongs to and the values
 * its field holds, and the bar hides the rows without the chosen value with one rule the engine
 * writes. A site writes no rule of its own, so a value nobody foresaw still filters.
 *
 * No directive here: the client bar and the binder both read it.
 */

/** The bars a row belongs to, separated by spaces: a row of a nested source has two. */
export const FILTER_ATTR = "data-bp-filter";
/** The row's values, each one `<bar id>:<filterToken>`, separated by spaces. */
export const FILTER_VALUES_ATTR = "data-bp-filter-values";
/** Set on the bar to the chosen value, and absent while everything shows. */
export const FILTER_CHOSEN_ATTR = "data-bp-filter-value";
/**
 * Set on every block of a row of a source that holds a `filterInput`: `<id>:<n>`, the same number on
 * each block of one row, so a row of several blocks is matched on all its text as one.
 */
export const FILTER_ROW_ATTR = "data-bp-filter-row";
/** What a `filterInput` writes onto the blocks of a row its text left out: the ids, separated by spaces. */
export const FILTER_MISS_ATTR = "data-bp-filter-miss";
/** Marks the box's root, holding the id of the filter it runs. */
export const FILTER_INPUT_ATTR = "data-bp-filter-input";
/** The live count's element, holding the label it is written from. */
export const FILTER_COUNT_ATTR = "data-bp-filter-count";
/** The no-match line's element, holding the label it is written from. */
export const FILTER_EMPTY_ATTR = "data-bp-filter-empty";

/**
 * A value as one whitespace-free token, so a row with several values can be matched with `~=` and a
 * value holding a space is still one token. Percent-encoding is reversible and turns every space,
 * quote and angle bracket into something else.
 */
export function filterToken(value: string): string {
    return encodeURIComponent(wellFormed(value));
}

/*
 * A lone surrogate is valid JSON and refused by `encodeURIComponent`, which throws, and a throw here
 * takes the whole page down. It becomes U+FFFD, as a browser would show it.
 */
function wellFormed(value: string): string {
    return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

/** A value under one bar, so one row can carry the values of two bars and each rule reads its own. */
export function markToken(id: string, value: string): string {
    return `${id}:${filterToken(value)}`;
}

export interface FilterMark {
    id: string;
    values: string[];
    /** The row's number under this id, set only when the source holds a `filterInput`. */
    row?: number;
}

/** The attributes for a block the binder marked. */
export function filterAttrs(marks: readonly FilterMark[]): Record<string, string> {
    const attrs: Record<string, string> = {
        [FILTER_ATTR]: marks.map((mark) => mark.id).join(" "),
        [FILTER_VALUES_ATTR]: marks.flatMap((mark) => mark.values.map((value) => markToken(mark.id, value))).join(" "),
    };
    const rows = marks.filter((mark) => mark.row !== undefined).map((mark) => `${mark.id}:${mark.row}`);
    if (rows.length > 0) attrs[FILTER_ROW_ATTR] = rows.join(" ");
    return attrs;
}

/*
 * A CSS string with every character outside a short safe set written as a hex escape. The trailing
 * space ends the escape, and CSS drops it. A quote, a backslash, a newline or `</style>` cannot
 * leave the string, whatever the value was.
 */
export function cssString(value: string): string {
    let out = "";
    for (const ch of value) {
        out += /[A-Za-z0-9_-]/.test(ch) ? ch : `\\${ch.codePointAt(0)!.toString(16)} `;
    }
    return `"${out}"`;
}

/**
 * The rule that hides every row of bar `id` whose values do not hold `value`. `!important` so it
 * wins over a row's own inline `display`, which the wrapper around a transparent block sets.
 */
export function filterRule(id: string, value: string): string {
    return (
        `[${FILTER_ATTR}~=${cssString(id)}]:not([${FILTER_VALUES_ATTR}~=${cssString(markToken(id, value))}])` +
        `{display:none!important}`
    );
}

/**
 * The rule that hides the blocks of box `id`'s rows that the typed words left out. It is the same
 * kind of rule as `filterRule`, and matches only a block the script marked, so with no script and at
 * rest it matches nothing and every row shows. The two rules each hide, so a row shows only when
 * both the chosen value and the typed words let it.
 */
export function textRule(id: string): string {
    return `[${FILTER_MISS_ATTR}~=${cssString(id)}]{display:none!important}`;
}

export interface FilterState {
    id: string;
    values: string[];
}

/** JSON, because a value may hold any character and the state is one string field. */
export function writeFilterState(state: FilterState): string {
    return JSON.stringify(state);
}

export function readFilterState(value: string | undefined): FilterState | null {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== "object") return null;
        const { id, values } = parsed as Record<string, unknown>;
        if (typeof id !== "string" || id === "" || !Array.isArray(values)) return null;
        if (!values.every((v) => typeof v === "string" && v !== "")) return null;
        return { id, values: values as string[] };
    } catch {
        return null;
    }
}
