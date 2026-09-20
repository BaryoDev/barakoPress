import type { PressTheme, ThemeSpace, ThemeText } from "../theme.js";

/*
 * The tokens a block primitive is allowed to name.
 *
 * A primitive takes a tone, a space name and a text role. It never takes a colour or a pixel value,
 * because a site where anyone can assemble a page from primitives only stays one design if the
 * parts cannot carry their own. This is also the layer #49 moves: the theme's colour slots are
 * still named after barakocms.com, and a tone is the role name that stands between a block and
 * those slots, so renaming them is a change here and nowhere else.
 */

export const TONES = ["page", "surface", "accent", "inverse"] as const;
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

export function toneOf(theme: PressTheme, name: string | undefined): Tone {
    const c = theme.colors;
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
