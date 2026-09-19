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

/** The scopes a page may read. `viewer` arrives with barakoPress #7. */
export const BINDING_SCOPES = ["site", "page", "item", "query", "props"] as const;
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
}

/*
 * One placeholder. The path charset is barakoCMS's, the fallback is bounded and may not contain a
 * brace so it cannot swallow the rest of the template. Both quantified groups match disjoint
 * characters, so there is no backtracking to blow up on.
 */
const PLACEHOLDER =
    /\{\{\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*(?:\|\s*([A-Za-z][A-Za-z0-9]{0,15})\s*)?(?:\?\?([^{}]{0,200}?))?\s*\}\}/g;

/** The longest template this reads. A stored prop is editor input, and scanning is work. */
export const MAX_TEMPLATE = 4000;

export function hasBinding(value: string): boolean {
    if (value.length > MAX_TEMPLATE) return false;
    PLACEHOLDER.lastIndex = 0;
    return PLACEHOLDER.test(value);
}

function isScope(value: string): value is BindingScope {
    return (BINDING_SCOPES as readonly string[]).includes(value);
}

function isFormat(value: string): value is BindingFormat {
    return (BINDING_FORMATS as readonly string[]).includes(value);
}

/** Every placeholder in a template, in order. What an editor wrote, not what it resolves to. */
export function readBindings(value: string): Binding[] {
    if (value.length > MAX_TEMPLATE) return [];
    const found: Binding[] = [];
    PLACEHOLDER.lastIndex = 0;
    for (const match of value.matchAll(PLACEHOLDER)) {
        const [scope, ...rest] = match[1].split(".");
        const format = match[2] ?? "text";
        found.push({
            raw: match[0],
            scope,
            path: rest.join("."),
            format: isFormat(format) ? format : "text",
            fallback: (match[3] ?? "").trim(),
        });
    }
    return found;
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
}

export interface BindingOptions {
    locale: string;
    /** The ISO code `money` formats with. Unset formats an amount as a plain number. */
    currency?: string;
    onProblem?: (problem: BindingProblem) => void;
}

/** Reads a scope once per render and remembers it, so ten placeholders are one read. */
export class BindingSource {
    private readonly cache = new Map<BindingScope, Record<string, unknown> | null>();

    constructor(
        private readonly scopes: BindingScopes,
        readonly options: BindingOptions,
    ) {}

    /** A scope with these values on top of the ones it already has. `repeat` makes one per row. */
    with(extra: BindingScopes): BindingSource {
        return new BindingSource({ ...this.scopes, ...extra }, this.options);
    }

    async read(scope: BindingScope): Promise<Record<string, unknown> | null> {
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
}

/** Own properties only, so a stored path cannot walk into the prototype chain. */
function walk(root: Record<string, unknown>, path: string): unknown {
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
): Promise<{ text: string; bound: boolean; missing: BindingProblem[] }> {
    const bindings = readBindings(template);
    if (bindings.length === 0) return { text: template, bound: false, missing: [] };

    const missing: BindingProblem[] = [];
    const resolved = new Map<string, string>();
    const report = (binding: Binding, reason: BindingProblem["reason"]): void => {
        const problem: BindingProblem = { binding: binding.raw, reason };
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
        const scope = await source.read(binding.scope);
        const value = scope === null ? undefined : walk(scope, binding.path);
        const text = formatValue(value, binding.format, source.options);
        if (text === null) report(binding, scope === null ? "unbound scope" : "no value");
        resolved.set(binding.raw, text ?? binding.fallback);
    }

    // One pass over the original, and what a placeholder resolved to is never scanned again.
    PLACEHOLDER.lastIndex = 0;
    const text = template.replace(PLACEHOLDER, (raw) => resolved.get(raw) ?? raw);
    return { text, bound: true, missing };
}
