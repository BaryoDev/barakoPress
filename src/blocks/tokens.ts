import { themeColor, type PressTheme, type ThemeSpace, type ThemeText } from "../theme.js";

/*
 * The tokens a block primitive is allowed to name.
 *
 * A primitive takes a tone, a space name and a text role. It never takes a colour or a pixel value,
 * because a site where anyone can assemble a page from primitives only stays one design if the
 * parts cannot carry their own. This is also the layer #49 moves: the theme's colour slots are
 * still named after barakocms.com, and a tone is the role name that stands between a block and
 * those slots, so renaming them is a change here and nowhere else.
 */

export const TONES = ["page", "surface", "accent", "inverse", "gradient", "wash"] as const;
export type ToneName = (typeof TONES)[number];

export interface Tone {
    bg: string;
    ink: string;
    secondaryInk: string;
    muted: string;
    hairline: string;
    accent: string;
    /** Text on a filled accent. */
    onAccent: string;
}

/** The names of the site's own tones, in the order it gave them. */
export function toneNames(theme: PressTheme): string[] {
    return theme.tones ? Object.keys(theme.tones) : [];
}

/*
 * A site's own tone is three colours, so the other roles follow them: every kind of ink is the ink,
 * and a filled accent is drawn in the ink with the background as its text. That keeps a tone as
 * readable as the pair the site chose, whatever the page tone is.
 */
function ownTone(theme: PressTheme, name: string): Tone | undefined {
    const spec = theme.tones && Object.hasOwn(theme.tones, name) ? theme.tones[name] : undefined;
    if (!spec) return undefined;
    const page = toneOf(theme, undefined);
    const ink = themeColor(theme, spec.ink) ?? page.ink;
    const bg = themeColor(theme, spec.bg) ?? page.bg;
    return {
        bg,
        ink,
        secondaryInk: ink,
        muted: ink,
        hairline: themeColor(theme, spec.edge) ?? page.hairline,
        accent: ink,
        onAccent: bg,
    };
}

export function toneOf(theme: PressTheme, name: string | undefined): Tone {
    const c = theme.colors;
    const own = name !== undefined && !(TONES as readonly string[]).includes(name) ? ownTone(theme, name) : undefined;
    if (own) return own;
    switch (name) {
        case "surface":
            return {
                bg: c.surface,
                ink: c.ink,
                secondaryInk: c.secondaryInk,
                muted: c.muted,
                hairline: c.hairline,
                accent: c.accent,
                onAccent: c.surface,
            };
        case "accent":
            return {
                bg: c.accentTint,
                ink: c.ink,
                secondaryInk: c.secondaryInk,
                muted: c.accentInk,
                hairline: c.accentTintBorder,
                accent: c.accentInk,
                onAccent: c.surface,
            };
        /*
         * The inverse band with its stops spread across it. The colours are the theme's own three
         * dark roles, in that order, so a tenant that restyles gets its own gradient and no block
         * anywhere names a colour. `bg` is a background rather than a colour, which is what both
         * the section and the panel already set it as.
         */
        case "gradient":
            return {
                bg: `linear-gradient(145deg, ${c.inverse} 0%, ${c.accentInk} 55%, ${c.inverseAccent} 100%)`,
                ink: c.surface,
                secondaryInk: c.inverseInk,
                muted: c.inverseInk,
                hairline: c.inverseChrome,
                accent: c.inverseAccent,
                onAccent: c.inverse,
            };
        case "inverse":
            return {
                bg: c.inverse,
                ink: c.surface,
                secondaryInk: c.inverseInk,
                muted: c.inverseInk,
                hairline: c.inverseChrome,
                accent: c.inverseAccent,
                onAccent: c.inverse,
            };
        /*
         * A page wash: the page's own background with the accent tint glowing from behind the top
         * of the band, for a hero that sits over decoration rather than a flat colour. Declared from
         * the theme's own tokens, the same way `gradient` is, so a tenant that restyles gets its own
         * wash and no primitive anywhere writes a colour of its own.
         */
        case "wash":
            return {
                bg: `radial-gradient(120% 100% at 50% -20%, ${c.accentTint} 0%, ${c.pageBg} 60%)`,
                ink: c.ink,
                secondaryInk: c.secondaryInk,
                muted: c.muted,
                hairline: c.hairline,
                accent: c.accent,
                onAccent: c.surface,
            };
        default:
            return {
                bg: c.pageBg,
                ink: c.ink,
                secondaryInk: c.secondaryInk,
                muted: c.muted,
                hairline: c.hairline,
                accent: c.accent,
                onAccent: c.surface,
            };
    }
}

export const SPACES = ["none", "xs", "sm", "md", "lg", "xl", "xxl"] as const satisfies readonly (keyof ThemeSpace)[];

export function spaceOf(theme: PressTheme, name: string | undefined, fallback: keyof ThemeSpace = "md"): string {
    const key = (SPACES as readonly string[]).includes(name ?? "") ? (name as keyof ThemeSpace) : fallback;
    return theme.space[key];
}

export const TEXT_ROLES = [
    "meta",
    "small",
    "body",
    "lead",
    "subheading",
    "heading",
    "title",
    "display",
] as const satisfies readonly (keyof ThemeText)[];

/** What a text variant renders as, and at which role of the scale. */
export const TEXT_VARIANTS: Record<string, { tag: "h1" | "h2" | "h3" | "h4" | "p"; role: keyof ThemeText }> = {
    display: { tag: "h1", role: "display" },
    title: { tag: "h2", role: "title" },
    heading: { tag: "h3", role: "heading" },
    subheading: { tag: "h4", role: "subheading" },
    lead: { tag: "p", role: "lead" },
    body: { tag: "p", role: "body" },
    small: { tag: "p", role: "small" },
    meta: { tag: "p", role: "meta" },
};

export const TEXT_VARIANT_NAMES = Object.keys(TEXT_VARIANTS);

export const ALIGNMENTS = ["start", "center", "end"] as const;

export function alignOf(name: string | undefined): "flex-start" | "center" | "flex-end" {
    return name === "center" ? "center" : name === "end" ? "flex-end" : "flex-start";
}

export function textAlignOf(name: string | undefined): "left" | "center" | "right" | undefined {
    return name === "center" ? "center" : name === "end" ? "right" : name === "start" ? "left" : undefined;
}

export const RADII = ["none", "control", "panel", "pill"] as const;

export function radiusOf(theme: PressTheme, name: string | undefined): string {
    switch (name) {
        case "control":
            return theme.radii.control;
        case "pill":
            return theme.radii.pill;
        case "panel":
            return theme.radii.panel;
        default:
            return "0";
    }
}

export const WIDTHS = ["prose", "wide", "full"] as const;

export function widthOf(theme: PressTheme, name: string | undefined): string | undefined {
    if (name === "prose") return theme.layout.prose;
    if (name === "full") return undefined;
    return theme.layout.wide;
}
