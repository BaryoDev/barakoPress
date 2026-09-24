/*
 * The filter a `filterBar` draws over the rows of the `source` around it (#129).
 *
 * The rows stay server-rendered. The binder marks each one with the bar it belongs to and the values
 * its field holds, and the bar hides the rows without the chosen value with one rule the engine
 * writes. A site writes no rule of its own, so a value nobody foresaw still filters.
 *
 * No directive here: the client bar and the binder both read it.
 */

/** Which bar a row belongs to. */
export const FILTER_ATTR = "data-bp-filter";
/** The row's values, each one a token of `filterToken`, separated by spaces. */
export const FILTER_VALUES_ATTR = "data-bp-filter-values";
/** Set on the bar to the chosen value, and absent while everything shows. */
export const FILTER_CHOSEN_ATTR = "data-bp-filter-value";

/**
 * A value as one whitespace-free token, so a row with several values can be matched with `~=` and a
 * value holding a space is still one token. Percent-encoding is reversible and turns every space,
 * quote and angle bracket into something else.
 */
export function filterToken(value: string): string {
    return encodeURIComponent(value);
}

export function filterTokens(values: readonly string[]): string {
    return values.map(filterToken).join(" ");
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
        `[${FILTER_ATTR}=${cssString(id)}]:not([${FILTER_VALUES_ATTR}~=${cssString(filterToken(value))}])` +
        `{display:none!important}`
    );
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
