/*
 * What the post page looks like, as configuration.
 *
 * The seam in config.ts covers data: which type holds posts, what the fields are called, where the
 * routes are mounted. It says nothing about appearance, and that gap is why barakocms.com does not
 * use `PostView` at all. It reimplemented the whole page inline, because the screen came with a
 * stylesheet the site never imports and rendered on a blank page. The second consumer would have
 * done the same, and two forks of a screen is the thing this package exists to prevent.
 *
 * So the look is tokens, and the screens style themselves from them inline. Inline rather than a
 * stylesheet on purpose: `barakopress/styles.css` is opt-in, and a screen whose look depends on an
 * import the consumer may not make is a screen that renders unstyled for somebody. Inline styles
 * arrive with the markup and cannot be forgotten.
 *
 * The defaults are the barakoCMS palette, the same values styles.css carries, so a site that wants
 * the house look passes nothing.
 */

import { TONES } from "./blocks/tokens.js";
import { fontSourcesFrom } from "./fonts.js";

export interface ThemeColors {
    /** The page behind the bands. */
    pageBg: string;
    /** Cards, panels, and the bands that sit above the page. */
    surface: string;
    /** Headings and anything that has to read as primary. */
    ink: string;
    /** Body copy in the prose column, which is deliberately lighter than a heading. */
    proseInk: string;
    /** Supporting copy outside the prose column. */
    secondaryInk: string;
    /** Meta: dates, labels, captions. */
    muted: string;
    hairline: string;
    accent: string;
    accentHover: string;
    /** Accent dark enough to carry small text on the tint. */
    accentInk: string;
    accentTint: string;
    accentTintBorder: string;
    /** The accent border where it has to hold its own: under a control, or on a filled tint. */
    accentBorderStrong: string;
    /** The band that reverses the page: the footer, a code panel, an inverse block. */
    inverse: string;
    /** Controls and rules on the inverse band. */
    inverseChrome: string;
    /** Copy on the inverse band. */
    inverseInk: string;
    /** The accent on the inverse band, which is rarely the accent on the page. */
    inverseAccent: string;
    /** Code, the one thing in a palette named after what it marks up rather than where it sits. */
    code: string;
    success: string;
    /** @deprecated 0.6.0, removed in 2.0.0. Use `accentBorderStrong`; the two are kept in step. */
    accentTintBorderStrong: string;
    /** @deprecated 0.6.0, removed in 2.0.0. Use `inverse`; the two are kept in step. */
    darkPanel: string;
    /** @deprecated 0.6.0, removed in 2.0.0. Use `inverseChrome`; the two are kept in step. */
    darkPanelChrome: string;
    /** @deprecated 0.6.0, removed in 2.0.0. Use `inverseInk`; the two are kept in step. */
    darkPanelInk: string;
    /** @deprecated 0.6.0, removed in 2.0.0. Use `inverseAccent`; the two are kept in step. */
    darkPanelAccent: string;
    /** @deprecated 0.6.0, removed in 2.0.0. Use `code`; the two are kept in step. */
    codeGreen: string;
}

/*
 * The slot names that shipped in 0.3.0, and the role each one is now (#49).
 *
 * The old names are barakocms.com's design read back as a palette: a bakery with a cream footer had
 * to put cream in `darkPanel`, and a school with no code sample still set `codeGreen`. The roles say
 * what the colour is for instead.
 *
 * Both names stay, and stay equal. A tenant's `Colors` entry holds whichever name it was saved with,
 * and a consumer's own component may read either, so setting one sets the other and neither becomes
 * the odd one out. Set both to different colours and the role wins, since that is the name that
 * survives.
 */
export const COLOR_ALIASES: Readonly<Record<string, keyof ThemeColors>> = {
    accentTintBorderStrong: "accentBorderStrong",
    darkPanel: "inverse",
    darkPanelChrome: "inverseChrome",
    darkPanelInk: "inverseInk",
    darkPanelAccent: "inverseAccent",
    codeGreen: "code",
};

/** Colours merged over a base, with each old slot and its role name left holding the same colour. */
export function mergeColors(base: ThemeColors, named: Partial<Record<string, string>>): ThemeColors {
    const out = { ...base } as Record<string, string>;
    const set = (key: string) => typeof named[key] === "string" && named[key] !== "";
    for (const key of Object.keys(base)) if (set(key)) out[key] = named[key] as string;
    for (const [old, role] of Object.entries(COLOR_ALIASES)) {
        if (set(role)) out[old] = named[role] as string;
        else if (set(old)) out[role] = named[old] as string;
    }
    return out as unknown as ThemeColors;
}

export interface ThemeFonts {
    /** Headings and the wordmark. */
    heading: string;
    /** Body and UI. */
    body: string;
    /** Code, meta and labels. The distinction is load bearing: every machine-produced value is mono. */
    mono: string;
}

export type FontRole = keyof ThemeFonts;

/**
 * The stylesheet that loads a role's face, for a site that does not load it from Google Fonts. Held
 * to the deployment's allow list when the head is built. The reasoning is in fonts.ts.
 */
export type ThemeFontSources = Partial<Record<FontRole, string>>;

export interface ThemeRadii {
    panel: string;
    control: string;
    pill: string;
}

export interface ThemeLayout {
    /** The reading column. */
    prose: string;
    /** Bands that deliberately break out of the reading column. */
    wide: string;
    /** Side padding on every band. */
    gutter: string;
    /** The narrowest a column gets before a row or a grid wraps it onto its own line. */
    columnMin: string;
}

/**
 * The spacing scale. Block primitives take one of these names, never a pixel value, so a tenant
 * that wants roomier pages changes the scale once instead of every block on every page.
 */
export interface ThemeSpace {
    none: string;
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    xxl: string;
}

/**
 * The type scale, by role rather than by size, for the same reason. `text` names the role a
 * primitive asks for; what that measures is the theme's business.
 */
export interface ThemeText {
    meta: string;
    small: string;
    body: string;
    lead: string;
    subheading: string;
    heading: string;
    title: string;
    display: string;
    /** A page's own h1, the one size that scales with the viewport rather than sitting still. */
    pageTitle: string;
}

/**
 * An asset used exactly as it was supplied: no tint, no border, no corner, no shadow, no filter, no
 * crop, and a minimum clear space held around it. A mark with an identity manual behind it (#29).
 */
export interface SuppliedAsset {
    /** The image URL. Matched without its query, so a mark the CMS resized with `?w=480` is it. */
    url: string;
    /** The minimum clear space, a name from the spacing scale. `md` when unset. */
    clearSpace?: string;
}

/**
 * A tone a site names beside the built-in six (#125). Each value is a token name, a colour slot name,
 * or a colour written out, looked up in that order when the tone is drawn.
 */
export interface ThemeTone {
    /** Text, and anything else drawn on the tone. */
    ink: string;
    /** The background. */
    bg: string;
    /** Hairlines and borders. */
    edge: string;
}

export interface PressTheme {
    colors: ThemeColors;
    fonts: ThemeFonts;
    /**
     * Where a role's face is loaded from, when it is not Google Fonts. Absent, and for any role it
     * leaves out, the family name is linked from Google Fonts as it always was.
     */
    fontSources?: ThemeFontSources;
    radii: ThemeRadii;
    layout: ThemeLayout;
    space: ThemeSpace;
    text: ThemeText;
    /**
     * The assets the theme may not touch. Here rather than beside the logo in `SiteIdentity`
     * because the theme is the one thing every drawing path carries, a block component included,
     * and a rule a block cannot see is a rule blocks do not keep.
     */
    asSupplied: readonly SuppliedAsset[];
    /**
     * Named colours, lengths and font stacks, emitted as `--t-<name>` on the root. Absent when the
     * site names none, which is what keeps a site that sets nothing rendering as it did.
     */
    tokens?: Readonly<Record<string, string>>;
    /** Tones beside the built-in six, by name. Absent when the site names none. */
    tones?: Readonly<Record<string, ThemeTone>>;
}

export type PressThemeInput = {
    colors?: Partial<ThemeColors>;
    fonts?: Partial<ThemeFonts>;
    fontSources?: ThemeFontSources;
    radii?: Partial<ThemeRadii>;
    layout?: Partial<ThemeLayout>;
    space?: Partial<ThemeSpace>;
    text?: Partial<ThemeText>;
    asSupplied?: readonly SuppliedAsset[];
    tokens?: Record<string, string>;
    tones?: Record<string, ThemeTone>;
};

export const DEFAULT_THEME: PressTheme = {
    colors: {
        pageBg: "#FAFAFC",
        surface: "#FFFFFF",
        ink: "#101223",
        proseInk: "#2B2E45",
        secondaryInk: "#4A4E66",
        muted: "#63687D",
        hairline: "#E7E8F1",
        accent: "#5A46D6",
        accentHover: "#4A38C0",
        accentInk: "#4034A8",
        accentTint: "#EEEBFD",
        accentTintBorder: "#DED8FB",
        accentBorderStrong: "#C9C1F5",
        inverse: "#101223",
        inverseChrome: "#2A2C45",
        inverseInk: "#DED8FB",
        inverseAccent: "#A99BF7",
        code: "#7BE0C4",
        success: "#0B7A6B",
        accentTintBorderStrong: "#C9C1F5",
        darkPanel: "#101223",
        darkPanelChrome: "#2A2C45",
        darkPanelInk: "#DED8FB",
        darkPanelAccent: "#A99BF7",
        codeGreen: "#7BE0C4",
    },
    fonts: {
        heading: "'Sora', ui-sans-serif, system-ui, sans-serif",
        body: "'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        mono: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
    },
    radii: {
        panel: "14px",
        control: "11px",
        pill: "999px",
    },
    layout: {
        prose: "780px",
        wide: "1160px",
        gutter: "40px",
        columnMin: "240px",
    },
    space: {
        none: "0",
        xs: "8px",
        sm: "12px",
        md: "20px",
        lg: "32px",
        xl: "48px",
        xxl: "80px",
    },
    text: {
        meta: "12.5px",
        small: "14.5px",
        body: "17px",
        lead: "20px",
        subheading: "17px",
        heading: "21px",
        title: "26px",
        display: "38px",
        pageTitle: "clamp(32px, 4.4vw, 52px)",
    },
    asSupplied: [],
};

/** Entries with a URL, and no more than a site could plausibly protect. */
function suppliedAssets(input: readonly SuppliedAsset[] | undefined): readonly SuppliedAsset[] {
    if (!input) return DEFAULT_THEME.asSupplied;
    return input
        .filter((asset) => typeof asset?.url === "string" && asset.url.trim() !== "")
        .map((asset) => ({ url: asset.url.trim(), ...(asset.clearSpace ? { clearSpace: asset.clearSpace } : {}) }))
        .slice(0, 24);
}

/*
 * The shapes a tenant-supplied theme value may take. It reaches a stylesheet, so each is narrow.
 */
export const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]{1,60}\)|[a-z]{3,30})$/i;
const LENGTH_VALUE = "(?:0|\\d{1,4}(?:\\.\\d{1,3})?(?:px|rem|em|ch|%|vw|vh))";
export const LENGTH = new RegExp(`^${LENGTH_VALUE}$`);
/*
 * A length, or `clamp()` of exactly three of them (#100).
 *
 * The engine's own default page title is a clamp, and prose sizes h2 with one, so a tenant's type
 * scale is held to the same shape it is asked to match rather than one fixed length. This is a
 * tenant-supplied value reaching a stylesheet, so the pattern is deliberately narrow: three lengths
 * in parentheses and nothing else, no calc(), no extra arguments, no unmatched characters either
 * side. Anything that does not fully match is refused, the same as before.
 */
export const FLUID_LENGTH = new RegExp(
    `^(?:${LENGTH_VALUE}|clamp\\(\\s*${LENGTH_VALUE}\\s*,\\s*${LENGTH_VALUE}\\s*,\\s*${LENGTH_VALUE}\\s*\\))$`,
);
/** Families separated by commas, each a bare name or one in quotes. No parentheses, no semicolons. */
const FAMILY = `(?:'[A-Za-z0-9 -]{1,60}'|"[A-Za-z0-9 -]{1,60}"|[A-Za-z][A-Za-z0-9-]{0,40}(?: [A-Za-z0-9-]{1,40}){0,4})`;
const FONT_STACK = new RegExp(`^${FAMILY}(?:\\s*,\\s*${FAMILY}){0,11}$`);

/** A token name, which becomes `--t-<name>`. */
export const TOKEN_NAME = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
/** A tone name. Lower case, because a block stores it and a setting may be typed in any case. */
export const TONE_NAME = /^[a-z][a-z0-9-]{0,30}$/;
const MAX_TOKENS = 200;
const MAX_TONES = 40;

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tokenValue(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const value = v.trim();
    return value.length <= 300 && (COLOR.test(value) || FLUID_LENGTH.test(value) || FONT_STACK.test(value))
        ? value
        : undefined;
}

/**
 * Tokens read over a base, one at a time: a name that fails its check, or a value that is not a
 * colour, a length or a font stack, is dropped and the base keeps that name.
 */
export function tokensFrom(
    base: Readonly<Record<string, string>> | undefined,
    v: unknown,
): Readonly<Record<string, string>> | undefined {
    if (!isRecord(v)) return base;
    const out: Record<string, string> = { ...base };
    for (const [name, raw] of Object.entries(v).slice(0, MAX_TOKENS)) {
        const value = tokenValue(raw);
        if (value && TOKEN_NAME.test(name)) out[name] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The colour a tone value names: a token holding a colour, a colour slot, or a colour written out.
 * Undefined for anything else.
 */
export function themeColor(
    theme: Pick<PressTheme, "colors" | "tokens">,
    name: string,
): string | undefined {
    const token = theme.tokens && Object.hasOwn(theme.tokens, name) ? theme.tokens[name] : undefined;
    if (token !== undefined) return COLOR.test(token) ? token : undefined;
    const slots = theme.colors as unknown as Record<string, string>;
    if (Object.hasOwn(slots, name)) return slots[name];
    return COLOR.test(name) ? name : undefined;
}

/**
 * Tones read over a base, one at a time. A tone keeps its references as written, so a token changed
 * later changes the tone too; each one has to resolve now, against these tokens and colours, or the
 * tone is dropped. A built-in name is refused rather than replaced, since those follow `Colors`.
 */
export function tonesFrom(
    base: Readonly<Record<string, ThemeTone>> | undefined,
    v: unknown,
    theme: Pick<PressTheme, "colors" | "tokens">,
): Readonly<Record<string, ThemeTone>> | undefined {
    if (!isRecord(v)) return base;
    const out: Record<string, ThemeTone> = { ...base };
    for (const [raw, spec] of Object.entries(v).slice(0, MAX_TONES)) {
        const name = raw.trim().toLowerCase();
        if (!TONE_NAME.test(name) || (TONES as readonly string[]).includes(name) || !isRecord(spec)) continue;
        const read = (key: keyof ThemeTone) => {
            const value = typeof spec[key] === "string" ? (spec[key] as string).trim() : "";
            return value && themeColor(theme, value) ? value : undefined;
        };
        const ink = read("ink");
        const bg = read("bg");
        const edge = read("edge");
        if (ink && bg && edge) out[name] = { ink, bg, edge };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveTheme(input: PressThemeInput | undefined): PressTheme {
    // A stylesheet a site configures is checked for shape the same as one a tenant saves, so a typo
    // here is a missing face rather than a link to nowhere in every page.
    const sources = fontSourcesFrom(input?.fontSources);
    const colors = mergeColors(DEFAULT_THEME.colors, input?.colors ?? {});
    const tokens = tokensFrom(undefined, input?.tokens);
    const tones = tonesFrom(undefined, input?.tones, { colors, tokens });
    return {
        colors,
        fonts: { ...DEFAULT_THEME.fonts, ...input?.fonts },
        ...(sources ? { fontSources: sources } : {}),
        radii: { ...DEFAULT_THEME.radii, ...input?.radii },
        layout: { ...DEFAULT_THEME.layout, ...input?.layout },
        space: { ...DEFAULT_THEME.space, ...input?.space },
        text: { ...DEFAULT_THEME.text, ...input?.text },
        asSupplied: suppliedAssets(input?.asSupplied),
        ...(tokens ? { tokens } : {}),
        ...(tones ? { tones } : {}),
    };
}

/*
 * A rendered body is a string of HTML, so it is the one part of a screen inline styles cannot
 * reach. This is the stylesheet for it, generated from the same tokens so the prose column and the
 * markup around it cannot drift.
 *
 * Values are interpolated into CSS, and a token is a developer-supplied string rather than a
 * constant, so they are stripped of the two characters that could close the element early. Nobody
 * is expected to put a bracket in a colour; this is here so that a config that somehow carries one
 * produces a broken rule instead of an injected tag.
 */
function css(value: string): string {
    return value.replace(/[<>]/g, "");
}

export function proseCss(theme: PressTheme, scope: string): string {
    const c = theme.colors;
    const f = theme.fonts;
    const s = `.${scope}`;

    return [
        `${s}{font-family:${css(f.body)};font-size:17.5px;line-height:1.75;color:${css(c.proseInk)};text-wrap:pretty}`,
        `${s} > *:first-child{margin-top:0}`,
        `${s} p{margin:18px 0 0}`,
        `${s} h2{margin:56px 0 0;font-family:${css(f.heading)};font-weight:600;font-size:clamp(24px,2.8vw,32px);line-height:1.15;letter-spacing:-.03em;color:${css(c.ink)};text-wrap:balance}`,
        `${s} h3{margin:38px 0 0;font-family:${css(f.heading)};font-weight:600;font-size:21px;line-height:1.25;letter-spacing:-.025em;color:${css(c.ink)}}`,
        `${s} h4{margin:30px 0 0;font-family:${css(f.heading)};font-weight:600;font-size:17px;color:${css(c.ink)}}`,
        `${s} ul,${s} ol{margin:18px 0 0;padding-left:1.4rem}`,
        `${s} ul{list-style:disc}`,
        `${s} ol{list-style:decimal}`,
        `${s} li{margin:.5rem 0}`,
        `${s} li > ul,${s} li > ol{margin:.4rem 0}`,
        // overflow-wrap for the same reason `code` has it, and the reason it was missed: a long token
        // in running text is usually a name, and a name written as a link is a URL, which is longer.
        // A changelog entry citing a wiki page laid a 390px viewport out 603px wide.
        `${s} a{color:${css(c.accent)};font-weight:600;text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}`,
        `${s} a:hover{color:${css(c.accentHover)}}`,
        `${s} strong{color:${css(c.ink)};font-weight:700}`,
        // No background on inline code. The handoff calls for it, and a tinted chip inside a
        // 17.5px line is the thing that makes body copy look like documentation.
        //
        // overflow-wrap so a long unbroken token (a binding name, a route) breaks rather than
        // running the page past the viewport (#101). white-space is "pre" inside a pre, which
        // this has no effect against, so the same rule serves inline code without touching it.
        `${s} code{font-family:${css(f.mono)};font-size:16px;color:${css(c.ink)};overflow-wrap:anywhere}`,
        // min-width so its own overflow-x scroller is not defeated by a flex ancestor, which
        // otherwise stretches to the content's width instead of the width offered to it (#101).
        `${s} pre{margin:30px 0 0;padding:18px 16px;border-radius:${css(theme.radii.panel)};background:${css(c.inverse)};color:${css(c.inverseInk)};font-family:${css(f.mono)};font-size:13.5px;line-height:1.85;overflow-x:auto;min-width:0}`,
        `${s} pre code{font-size:inherit;color:inherit}`,
        `${s} blockquote{margin:24px 0 0;padding:2px 0 2px 18px;border-left:2px solid ${css(c.accentTintBorder)};color:${css(c.secondaryInk)}}`,
        `${s} img{max-width:100%;height:auto;border-radius:${css(theme.radii.panel)};border:1px solid ${css(c.hairline)}}`,
        `${s} hr{margin:40px 0 0;border:0;border-top:1px solid ${css(c.hairline)}}`,
        // Its own scroller, so a wide table cannot make the page scroll sideways. min-width for
        // the same reason pre has one: a flex ancestor otherwise stretches to fit it anyway.
        `${s} table{display:block;overflow-x:auto;min-width:0;width:100%;margin:24px 0 0;border-collapse:collapse;font-size:14.5px}`,
        `${s} th,${s} td{border:1px solid ${css(c.hairline)};padding:.55rem .75rem;text-align:left;vertical-align:top}`,
        `${s} th{background:${css(c.pageBg)};color:${css(c.ink)};font-weight:700;white-space:nowrap}`,
    ].join("");
}

/*
 * Hover and focus for the related cards.
 *
 * These cannot be inline: a style attribute has no `:hover`, no `:focus-visible` and no media
 * query. It is the same generated-from-tokens trick the prose stylesheet uses, for the same
 * reason, and it stays small on purpose. The handoff's motion contract is deliberately minimal,
 * and the lift is the only movement on this part of the page.
 */
export function relatedCss(theme: PressTheme, scope: string): string {
    const c = theme.colors;
    const s = `.${scope}`;

    return [
        `${s}{transition:border-color .2s ease,transform .2s ease}`,
        `${s}:hover{border-color:${css(c.accent)};transform:translateY(-2px)}`,
        `${s}:focus-visible{outline:2px solid ${css(c.accent)};outline-offset:2px}`,
        `@media (prefers-reduced-motion: reduce){${s}{transition:none}${s}:hover{transform:none}}`,
    ].join("");
}

/*
 * The theme as the custom properties `barakopress/styles.css` reads, so the screens styled by class
 * (the index and the archives) take a site's palette as well as the ones styled inline. Emitted by
 * the site layout after the stylesheet, so these win over its defaults.
 *
 * A site's own tokens follow as `--t-<name>`, so a site's stylesheet and its blocks can read
 * `var(--t-accent)`. The prefix keeps them out of the way of the engine's names above.
 */
export function themeVariablesCss(theme: PressTheme): string {
    const c = theme.colors;
    const f = theme.fonts;
    const r = theme.radii;
    const vars: [string, string][] = [
        ["--background", c.pageBg],
        ["--foreground", c.ink],
        ["--muted", c.accentTint],
        ["--muted-foreground", c.secondaryInk],
        ["--card", c.surface],
        ["--border", c.hairline],
        ["--primary", c.accent],
        ["--primary-foreground", c.surface],
        ["--radius-chip", r.control],
        ["--radius-control", r.control],
        ["--radius-card", r.panel],
        ["--font-sans", f.body],
        ["--font-display", f.heading],
        ["--font-mono", f.mono],
        ...Object.entries(theme.tokens ?? {}).map(([name, value]): [string, string] => [`--t-${name}`, value]),
    ];
    return `:root{${vars.map(([name, value]) => `${name}:${css(value).replace(/[;{}]/g, "")}`).join(";")}}`;
}
