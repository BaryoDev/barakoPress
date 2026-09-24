import type { CSSProperties } from "react";
import type { PressTheme } from "./theme.js";

/*
 * Style recipes (#131): a named look a primitive can wear in place of its own.
 *
 * A primitive styles itself from tokens, which keeps every page one design and also means a designed
 * section cannot be rebuilt from primitives: the card on barakocms.com has a padding, a border and a
 * corner no token names. A recipe is that card said once, in the site settings, and a block names it
 * with `recipe: "card"`. Its declarations replace the block's own inline defaults.
 *
 * The values reach a style attribute, and React writes a style attribute by joining `name:value;`
 * with no CSS escaping, so a value holding `;` would add a declaration of its own. So a property is
 * one of a fixed list, and a value is held to a narrow alphabet: no `;`, `:`, braces, angle brackets,
 * backslash, `!`, `@` or comment, quotes only around a plain family name, and a function only when it
 * is on the list below. That rules out `url()`, `expression()`, `image-set()` and `attr()` by name
 * rather than by spotting them. A recipe cannot load anything, and cannot leave its own declaration.
 */

/** The properties a recipe may set, by what they are for. The CSS names, as a stylesheet writes them. */
export const RECIPE_PROPERTY_GROUPS = {
    box: [
        "display",
        "position",
        "box-sizing",
        "width",
        "min-width",
        "max-width",
        "height",
        "min-height",
        "max-height",
        "aspect-ratio",
        "overflow",
        "overflow-x",
        "overflow-y",
        "vertical-align",
        "opacity",
    ],
    spacing: [
        "margin",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "margin-block",
        "margin-inline",
        "padding",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "padding-block",
        "padding-inline",
        "gap",
        "row-gap",
        "column-gap",
    ],
    typography: [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-variant-numeric",
        "line-height",
        "letter-spacing",
        "text-align",
        "text-transform",
        "text-decoration",
        "text-underline-offset",
        "text-wrap",
        "text-overflow",
        "white-space",
        "overflow-wrap",
        "word-break",
    ],
    colour: ["color", "background", "background-color"],
    border: [
        "border",
        "border-top",
        "border-right",
        "border-bottom",
        "border-left",
        "border-color",
        "border-style",
        "border-width",
    ],
    radius: ["border-radius"],
    shadow: ["box-shadow", "text-shadow"],
    grid: [
        "grid-template-columns",
        "grid-template-rows",
        "grid-auto-flow",
        "grid-auto-rows",
        "grid-column",
        "grid-row",
        "justify-items",
        "place-items",
        "place-content",
    ],
    flex: [
        "flex",
        "flex-direction",
        "flex-wrap",
        "flex-grow",
        "flex-shrink",
        "flex-basis",
        "align-items",
        "align-content",
        "align-self",
        "justify-content",
        "justify-self",
        "order",
    ],
    /*
     * The engine's own custom properties. The tone a band hands the blocks inside it, the gap and
     * display of a block list, and the look of inline code in a text block. A recipe for a dark card
     * sets `--bp-ink` so the text inside reads, the same thing an inverse tone does.
     */
    engine: [
        "--bp-ink",
        "--bp-ink-soft",
        "--bp-muted",
        "--bp-hairline",
        "--bp-accent",
        "--bp-on-accent",
        "--bp-gap",
        "--bp-list",
        "--bp-code-ink",
        "--bp-code-bg",
        "--bp-code-size",
        "--bp-code-pad",
        "--bp-code-radius",
    ],
} as const satisfies Record<string, readonly string[]>;

export const RECIPE_PROPERTIES: readonly string[] = Object.values(RECIPE_PROPERTY_GROUPS).flat();

const PROPERTIES: ReadonlySet<string> = new Set(RECIPE_PROPERTIES);

/** The functions a value may call. Everything else, `url()` first, is refused. */
const FUNCTIONS: ReadonlySet<string> = new Set([
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "hwb",
    "lab",
    "lch",
    "oklab",
    "oklch",
    "color-mix",
    "calc",
    "min",
    "max",
    "clamp",
    "minmax",
    "repeat",
    "fit-content",
    "var",
    "linear-gradient",
    "radial-gradient",
    "conic-gradient",
    "repeating-linear-gradient",
    "repeating-radial-gradient",
]);

/*
 * `position` is held to the two values that keep an element in the flow. `absolute` and `fixed`
 * would let a block cover the page, a sticky band already exists for the one case that needs to
 * leave it, and a recipe on it cannot take its stickiness away (see `keep` in primitives.tsx).
 */
const ONLY: Readonly<Record<string, ReadonlySet<string>>> = {
    position: new Set(["static", "relative"]),
};

/** A recipe name, stored on a block as `recipe`. Lower case, as a tone name is. */
export const RECIPE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;
const MAX_RECIPES = 400;
const MAX_DECLARATIONS = 40;
const MAX_CLASSES = 8;
const MAX_VALUE = 240;

/** A family name in quotes, the only thing a value may quote. */
const QUOTED = /'[A-Za-z0-9 -]{1,60}'|"[A-Za-z0-9 -]{1,60}"/g;
const ALPHABET = /^[A-Za-z0-9 #%.,()/+*-]+$/;
const CALL = /(-?[A-Za-z_][A-Za-z0-9_-]*)\(/g;
const VAR_ARGUMENT = /^var\(\s*--[A-Za-z0-9-]{1,60}\s*[,)]/;

/**
 * `{name}` in a stored value: a token from `Tokens`, or `group.key` for a theme value, one of
 * `colors`, `space`, `radii`, `text`, `fonts` and `layout`.
 */
const REFERENCE = /\{([A-Za-z][A-Za-z0-9-]{0,39})(?:\.([A-Za-z][A-Za-z0-9-]{0,39}))?\}/g;
const GROUPS = ["colors", "space", "radii", "text", "fonts", "layout"] as const;

/** Whether a value, with every reference already resolved, is safe to write into a style. */
export function recipeValueOk(value: string): boolean {
    if (value.length === 0 || value.length > MAX_VALUE) return false;
    if (value.includes("/*") || value.includes("*/")) return false;
    const bare = value.replace(QUOTED, "q");
    if (!ALPHABET.test(bare)) return false;

    let depth = 0;
    for (const ch of bare) {
        if (ch === "(") depth++;
        else if (ch === ")" && --depth < 0) return false;
        if (depth > 6) return false;
    }
    if (depth !== 0) return false;

    for (const call of bare.matchAll(CALL)) {
        const name = call[1].toLowerCase();
        if (!FUNCTIONS.has(name)) return false;
        // A `var()` names a custom property and nothing else, so it cannot smuggle in a call.
        if (name === "var" && !VAR_ARGUMENT.test(bare.slice(call.index))) return false;
    }
    return true;
}

/** A stored value's shape, with each reference standing in as a harmless number until it resolves. */
function storedValueOk(value: string): boolean {
    return recipeValueOk(value.replace(REFERENCE, "0"));
}

export interface StyleRecipe {
    /**
     * Classes put on the element beside the style, space separated. For what a style attribute
     * cannot say, a hover, a focus ring or a media query, written in the site's own stylesheet.
     */
    class?: string;
    /** CSS property to value, as stored: the CSS name, and `{name}` where a value names the theme. */
    style: Readonly<Record<string, string>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function declarationsFrom(v: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!isRecord(v)) return out;
    for (const [raw, rawValue] of Object.entries(v)) {
        if (Object.keys(out).length >= MAX_DECLARATIONS) break;
        const property = raw.trim().toLowerCase();
        if (!PROPERTIES.has(property) || typeof rawValue !== "string") continue;
        const value = rawValue.trim();
        const only = ONLY[property];
        if (only ? only.has(value) : storedValueOk(value)) out[property] = value;
    }
    return out;
}

function classesFrom(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const names = v
        .split(/\s+/)
        .filter((name) => CLASS_NAME.test(name))
        .slice(0, MAX_CLASSES);
    return names.length > 0 ? names.join(" ") : undefined;
}

/**
 * Recipes read over a base, one at a time. A property off the list, or a value that fails its
 * check, is dropped and the rest of the recipe kept, the way `Colors` drops one bad colour. A recipe
 * left with nothing to say is dropped. References are kept as written and resolved when a block
 * draws, so a token changed later changes every recipe that names it.
 */
export function recipesFrom(
    base: Readonly<Record<string, StyleRecipe>> | undefined,
    v: unknown,
): Readonly<Record<string, StyleRecipe>> | undefined {
    if (!isRecord(v)) return base;
    const out: Record<string, StyleRecipe> = { ...base };
    for (const [raw, spec] of Object.entries(v).slice(0, MAX_RECIPES)) {
        const name = raw.trim().toLowerCase();
        if (!RECIPE_NAME.test(name) || !isRecord(spec)) continue;
        const style = declarationsFrom(spec.style);
        const cls = classesFrom(spec.class);
        if (Object.keys(style).length === 0 && !cls) continue;
        out[name] = { ...(cls ? { class: cls } : {}), style };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function lookup(theme: PressTheme, name: string, key: string | undefined): string | undefined {
    if (key === undefined) {
        return theme.tokens && Object.hasOwn(theme.tokens, name) ? theme.tokens[name] : undefined;
    }
    if (!(GROUPS as readonly string[]).includes(name)) return undefined;
    const group = theme[name as (typeof GROUPS)[number]] as unknown as Record<string, string>;
    return Object.hasOwn(group, key) ? group[key] : undefined;
}

/** A stored value with its references resolved, or undefined when one does not resolve or the result fails. */
export function resolveRecipeValue(theme: PressTheme, value: string): string | undefined {
    let missing = false;
    const out = value.replace(REFERENCE, (_, name: string, key: string | undefined) => {
        const found = lookup(theme, name, key);
        if (found === undefined) missing = true;
        return found ?? "";
    });
    return !missing && recipeValueOk(out) ? out : undefined;
}

function camel(property: string): string {
    return property.startsWith("--") ? property : property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export interface RecipeLook {
    className?: string;
    style: CSSProperties;
}

const looks = new WeakMap<PressTheme, Map<string, RecipeLook | null>>();

/** For tests: how many looks a theme has remembered. */
export function cachedLooks(theme: PressTheme): number {
    return looks.get(theme)?.size ?? 0;
}

/**
 * What a block naming `name` is drawn with, or undefined when the theme has no such recipe. A
 * declaration whose reference does not resolve is left out, so the rest of the recipe still draws.
 */
export function recipeLook(theme: PressTheme, name: string | undefined): RecipeLook | undefined {
    // A miss is not remembered: a name can come from bound content, and a theme configured in
    // defineConfig lives as long as the process, so caching misses would grow without bound.
    if (!name || !theme.recipes || !Object.hasOwn(theme.recipes, name)) return undefined;
    let cache = looks.get(theme);
    if (!cache) looks.set(theme, (cache = new Map()));
    const cached = cache.get(name);
    if (cached !== undefined) return cached ?? undefined;

    const recipe = Object.hasOwn(theme.recipes, name) ? theme.recipes[name] : undefined;
    let look: RecipeLook | null = null;
    if (recipe) {
        const style: Record<string, string> = {};
        for (const [property, value] of Object.entries(recipe.style)) {
            if (!PROPERTIES.has(property)) continue;
            const resolved = ONLY[property] ? (ONLY[property].has(value) ? value : undefined) : resolveRecipeValue(theme, value);
            if (resolved !== undefined) style[camel(property)] = resolved;
        }
        const className = classesFrom(recipe.class);
        look = { ...(className ? { className } : {}), style: style as CSSProperties };
    }
    cache.set(name, look);
    return look ?? undefined;
}
