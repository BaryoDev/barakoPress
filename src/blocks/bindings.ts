/*
 * Bindings: `{{scope.Field}}` inside a block's props.
 *
 * The syntax is barakoCMS's workflow template syntax with two additions, a format and a fallback:
 *
 *     {{site.Name}}
 *     {{item.Price | money}}
 *     {{page.PublishedAt | date ?? Not yet}}
 *
 * Paths, formats and fallbacks only. There is no expression language and no JavaScript here, and
 * that is deliberate rather than unfinished: an editor writing a page is not writing code, and a
 * template that can compute can also loop.
 *
 * Substitution is a single pass over the original template and a resolved value is never rescanned,
 * so a field whose stored value happens to contain "{{site.Name}}" renders those characters instead
 * of reaching another field. barakoCMS made the same choice in TemplateVariableExtractor, for the
 * same reason.
 *
 * A path that resolves to nothing renders its fallback, or the empty string when it has none, and
 * is reported. It never throws: a page is a list of blocks, and one renamed field must not take the
 * page down.
 */

/**
 * The scopes a page may read. `viewer` arrives with barakoPress #7.
 *
 * `count`, `sum` and `group` are about a set of rows rather than one (#128). `{{count.post}}` is how
 * many published entries a collection has, and `{{count}}` on its own, inside a `source`, is how many
 * that source's filter matched. `{{sum.Open}}` adds a numeric field over a source's rows,
 * `{{distinct.Repo}}` is how many different values a field holds among them, and `{{group.key}}` and
 * `{{group.count}}` name the group a `groupBy` source is repeating.
 */
export const BINDING_SCOPES = ["site", "page", "item", "query", "props", "count", "sum", "distinct", "group"] as const;
export type BindingScope = (typeof BINDING_SCOPES)[number];

export const BINDING_FORMATS = ["text", "date", "datetime", "time", "money", "number", "upper", "lower"] as const;
export type BindingFormat = (typeof BINDING_FORMATS)[number];

export interface Binding {
    /** The whole placeholder as it was written, so a caller can report what an editor typed. */
    raw: string;
    /** As typed. Not every one of these is a scope this engine knows. */
    scope: string;
    /** The path inside the scope, dots and all, for example "Author.Name". */
    path: string;
    format: BindingFormat;
    fallback: string;
}

/**
 * Why a binding did not resolve, for the page's validation rather than for a visitor.
 *
 * `unknown scope` is a word that is not a scope, most likely a typo. `unbound scope` is a real one
 * this page does not carry, such as `item` outside a repeat. `no value` is a scope that is there
 * and a path in it that is not, which is the renamed-field case.
 */
export interface BindingProblem {
    binding: string;
    reason: "unknown scope" | "unbound scope" | "no value";
    /**
     * The block type and the prop the placeholder was typed into, when the caller knows them. An
     * editor fixes a binding by opening the field that holds it, so a report that names the reason
     * and not the field leaves them reading every block on the page (#63).
     */
    block?: string;
    field?: string;
}

/** Where a template came from, carried into every problem it reports. */
export interface BindingWhere {
    block: string;
    field: string;
}

/*
 * Finding a placeholder and reading one are two jobs, and they are split on purpose.
 *
 * The scan is this and only this: two braces, a bounded run of characters that are not braces, two
 * braces. One quantifier, nothing optional beside it, and nothing it matches can also start what
 * follows it, so there is exactly one way to match at any position and no backtracking to pay for.
 * The grammar used to live in the pattern instead, with three `\s*` runs that could each split a
 * run of spaces several ways, and CodeQL was right that "{{{{0" followed by a few thousand spaces
 * made that quadratic. `MAX_TEMPLATE` bounded it rather than removing it, and one renderer serves
 * every tenant on the process, so a string typed in one tenant's console must not be able to spend
 * another tenant's CPU.
 *
 * What is inside the braces is then read with `indexOf`, `slice` and `trim`, and the two pieces
 * that have to hold a shape are checked against anchored patterns with fixed bounds. Same grammar,
 * same published contract, no backtracking anywhere.
 */
const PLACEHOLDER = /\{\{[^{}]{0,250}\}\}/g;

/** `scope.Path`, up to nine segments. Dots are not in the segment charset, so this cannot branch. */
const PATH = /^[A-Za-z0-9_]{1,60}(?:\.[A-Za-z0-9_]{1,60}){0,8}$/;
const FORMAT = /^[A-Za-z][A-Za-z0-9]{0,15}$/;

/** The longest fallback a placeholder may carry. Longer, and it is not read as one. */
const MAX_FALLBACK = 200;

/** The longest template this reads. A stored prop is editor input, and scanning is work. */
export const MAX_TEMPLATE = 4000;

function isScope(value: string): value is BindingScope {
    return (BINDING_SCOPES as readonly string[]).includes(value);
}

function isFormat(value: string): value is BindingFormat {
    return (BINDING_FORMATS as readonly string[]).includes(value);
}

/**
 * One `{{...}}` span as a binding, or null when what is between the braces is not one.
 *
 * Null leaves the span in the page exactly as it was typed, which is what barakoCMS does with a
 * variable it does not know and what an editor needs to see the typo.
 *
 * The fallback is split off first, so a `|` inside it stays part of it.
 */
function parse(raw: string): Binding | null {
    let rest = raw.slice(2, -2);

    let fallback = "";
    const question = rest.indexOf("??");
    if (question !== -1) {
        fallback = rest.slice(question + 2).trim();
        if (fallback.length > MAX_FALLBACK) return null;
        rest = rest.slice(0, question);
    }

    let format = "text";
    const bar = rest.indexOf("|");
    if (bar !== -1) {
        format = rest.slice(bar + 1).trim();
        if (!FORMAT.test(format)) return null;
        rest = rest.slice(0, bar);
    }

    const path = rest.trim();
    if (!PATH.test(path)) return null;

    const [scope, ...segments] = path.split(".");
    return {
        raw,
        scope,
        path: segments.join("."),
        format: isFormat(format) ? format : "text",
        fallback,
    };
}

export function hasBinding(value: string): boolean {
    if (value.length > MAX_TEMPLATE) return false;
    for (const match of value.matchAll(PLACEHOLDER)) {
        if (parse(match[0]) !== null) return true;
    }
    return false;
}

/** Every placeholder in a template, in order. What an editor wrote, not what it resolves to. */
export function readBindings(value: string): Binding[] {
    if (value.length > MAX_TEMPLATE) return [];
    const found: Binding[] = [];
    for (const match of value.matchAll(PLACEHOLDER)) {
        const binding = parse(match[0]);
        if (binding) found.push(binding);
    }
    return found;
}

/**
 * The binding a template is made of, when the whole of it is one plain placeholder: no text around
 * it, no format and no fallback. That is the form a `list` or a `group` takes a value in, because
 * what it stands for is an array or an object and not text, so a format or a fallback has nothing to
 * apply to.
 */
export function wholeBinding(value: string): Binding | null {
    const found = readBindings(value);
    if (found.length !== 1) return null;
    const [binding] = found;
    // Checked on the raw span rather than the parsed format, which reads `| text` as no format.
    if (value.trim() !== binding.raw || /[|?]/.test(binding.raw)) return null;
    return binding;
}

/** A value read out of a scope, before a format sees it. */
export type BindingValue = unknown;

/**
 * The values a page binds against. Each scope is a thunk so nothing is read for a page that binds
 * nothing: a site with no `site.` placeholder never reads its settings, and one with no `query.`
 * placeholder never touches searchParams, which is what keeps a static export buildable.
 */
export interface BindingScopes {
    site?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    page?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    item?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    query?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    props?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    sum?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    distinct?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    group?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    /**
     * A count by path rather than a record, because the path names what to count and each one is a
     * read of its own: the empty path is the enclosing source's total, any other a collection key.
     * Undefined is a count that could not be had.
     */
    count?: (path: string) => Promise<number | undefined> | number | undefined;
}

/** The scopes that are a record read once and walked, which is every scope but `count`. */
type RecordScope = Exclude<BindingScope, "count">;

export interface BindingOptions {
    locale: string;
    /** The ISO code `money` formats with. Unset formats an amount as a plain number. */
    currency?: string;
    onProblem?: (problem: BindingProblem) => void;
}

/** Reads a scope once per render and remembers it, so ten placeholders are one read. */
export class BindingSource {
    private readonly cache = new Map<RecordScope, Record<string, unknown> | null>();

    constructor(
        private readonly scopes: BindingScopes,
        readonly options: BindingOptions,
    ) {}

    /** A scope with these values on top of the ones it already has. `repeat` makes one per row. */
    with(extra: BindingScopes): BindingSource {
        return new BindingSource({ ...this.scopes, ...extra }, this.options);
    }

    async read(scope: RecordScope): Promise<Record<string, unknown> | null> {
        if (this.cache.has(scope)) return this.cache.get(scope) ?? null;
        const thunk = this.scopes[scope];
        let value: Record<string, unknown> | null = null;
        if (thunk) {
            try {
                const read = await thunk();
                value = read && typeof read === "object" ? read : null;
            } catch (e) {
                // A scope that cannot be read is a page missing a value, not a page that fails.
                // A framework signal (notFound, redirect) is not ours to swallow.
                if (e && typeof e === "object" && "digest" in e) throw e;
                value = null;
            }
        }
        this.cache.set(scope, value);
        return value;
    }

    /**
     * What a placeholder names: `bound` is false when its scope is not on this page at all. A count
     * is not remembered here, since `with` makes a new source per row; the thunk behind it is what
     * keeps a collection to one read a page.
     */
    async lookup(binding: Binding & { scope: BindingScope }): Promise<{ bound: boolean; value: unknown }> {
        if (binding.scope !== "count") {
            const scope = await this.read(binding.scope);
            return { bound: scope !== null, value: scope === null ? undefined : walk(scope, binding.path) };
        }
        const count = this.scopes.count;
        if (!count) return { bound: false, value: undefined };
        try {
            return { bound: true, value: await count(binding.path) };
        } catch (e) {
            if (e && typeof e === "object" && "digest" in e) throw e;
            return { bound: true, value: undefined };
        }
    }
}

/** Own properties only, so a stored path cannot walk into the prototype chain. */
export function walk(root: Record<string, unknown>, path: string): unknown {
    let current: unknown = root;
    for (const segment of path.split(".")) {
        if (current === null || typeof current !== "object") return undefined;
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
            current = current[index];
            continue;
        }
        if (!Object.hasOwn(current as object, segment)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

function dateText(value: unknown, locale: string, parts: Intl.DateTimeFormatOptions): string | null {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    try {
        return date.toLocaleString(locale, parts);
    } catch {
        return date.toISOString();
    }
}

function numberText(value: unknown, locale: string, parts: Intl.NumberFormatOptions): string | null {
    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    try {
        return new Intl.NumberFormat(locale, parts).format(n);
    } catch {
        return String(n);
    }
}

/**
 * A value as text, or null when there is nothing to show and the fallback stands in.
 *
 * A format that does not suit the value is a miss rather than a guess: `{{item.Name | money}}` on a
 * word renders the fallback, which an editor can see, instead of "NaN", which reads like data.
 */
export function formatValue(value: unknown, format: BindingFormat, options: BindingOptions): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) return null;
    const locale = options.locale;

    switch (format) {
        case "date":
            return dateText(value, locale, { year: "numeric", month: "long", day: "numeric" });
        case "datetime":
            return dateText(value, locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            });
        case "time":
            return dateText(value, locale, { hour: "2-digit", minute: "2-digit" });
        case "money":
            return numberText(
                value,
                locale,
                options.currency
                    ? { style: "currency", currency: options.currency }
                    : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
            );
        case "number":
            return numberText(value, locale, {});
        case "upper":
        case "lower": {
            const text = plain(value);
            return text === null ? null : format === "upper" ? text.toUpperCase() : text.toLowerCase();
        }
        default:
            return plain(value);
    }
}

function plain(value: unknown): string | null {
    if (Array.isArray(value)) {
        const parts = value.filter((v) => typeof v === "string" || typeof v === "number").map(String);
        return parts.length > 0 ? parts.join(", ") : null;
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "boolean") return value ? "true" : "";
    const text = String(value);
    return text === "" ? null : text;
}

/**
 * One template, resolved.
 *
 * Returns the text and whether every placeholder in it found a value. A caller that cares about the
 * difference between "resolved to nothing" and "had nothing to resolve" reads `bound`.
 */
export async function bindText(
    template: string,
    source: BindingSource,
    where?: BindingWhere,
): Promise<{ text: string; bound: boolean; missing: BindingProblem[] }> {
    const bindings = readBindings(template);
    if (bindings.length === 0) return { text: template, bound: false, missing: [] };

    const missing: BindingProblem[] = [];
    const resolved = new Map<string, string>();
    const report = (binding: Binding, reason: BindingProblem["reason"]): void => {
        const problem: BindingProblem = { binding: binding.raw, reason, ...where };
        missing.push(problem);
        source.options.onProblem?.(problem);
    };

    for (const binding of bindings) {
        if (resolved.has(binding.raw)) continue;
        // A word that is no scope is left exactly as typed, the way barakoCMS leaves an unknown
        // variable. Substituting nothing there would hide the typo from whoever wrote it.
        if (!isScope(binding.scope)) {
            report(binding, "unknown scope");
            continue;
        }
        const { bound, value } = await source.lookup({ ...binding, scope: binding.scope });
        const text = formatValue(value, binding.format, source.options);
        if (text === null) report(binding, bound ? "no value" : "unbound scope");
        resolved.set(binding.raw, text ?? binding.fallback);
    }

    // One pass over the original, and what a placeholder resolved to is never scanned again. A
    // span that is not a binding has nothing in the map and stays exactly as it was typed.
    const text = template.replace(PLACEHOLDER, (raw) => resolved.get(raw) ?? raw);
    return { text, bound: true, missing };
}

/**
 * A whole-value binding, resolved to what it names rather than to text: the array behind
 * `{{item.Tags}}`, the object behind `{{item.Author}}`. Undefined when there is nothing there, which
 * is reported the way a text binding's miss is.
 *
 * What comes back is data. The caller checks it against its field and never scans a string inside
 * it for placeholders.
 */
export async function bindValue(template: string, source: BindingSource, where?: BindingWhere): Promise<unknown> {
    const binding = wholeBinding(template);
    if (!binding) return undefined;
    const report = (reason: BindingProblem["reason"]): undefined => {
        const problem: BindingProblem = { binding: binding.raw, reason, ...where };
        source.options.onProblem?.(problem);
        return undefined;
    };
    if (!isScope(binding.scope)) return report("unknown scope");
    const { bound, value } = await source.lookup({ ...binding, scope: binding.scope });
    if (!bound) return report("unbound scope");
    if (value === undefined || value === null || value === "") return report("no value");
    return value;
}
