import type { FontRole, PressTheme, ThemeFontSources } from "./theme.js";

/*
 * Where a site's faces come from (#54).
 *
 * A family name on its own still means Google Fonts, which is what every site running today does.
 * A site that cannot use it, a school with a licensed face on its own host or a tenant that must
 * not send visitor addresses to a third party, names the stylesheet instead of the family alone.
 *
 * That URL arrives in a tenant's settings and ends up in a `<link>` in every visitor's page, so it
 * is untrusted input, and the tenant does not get to decide which origins a page reaches. The
 * deployment does, in `PRESS_FONT_ORIGINS`, read per request. A URL on any other origin is refused:
 * no link to it is rendered, the role falls back to its family name, and the log says so once. So
 * the worst a tenant can do by typing an origin into a settings field is lose its own stylesheet.
 *
 * The default list is Google Fonts alone, so a deployment that sets nothing renders exactly the
 * links it rendered before this existed.
 */

export const GOOGLE_FONTS_ORIGIN = "https://fonts.googleapis.com";
/** Where Google Fonts serves the font files themselves, which is a second connection worth opening. */
export const GOOGLE_FONTS_FILES_ORIGIN = "https://fonts.gstatic.com";

/** The roles a theme loads a face for, in the order the head links them. */
export const FONT_ROLES: readonly FontRole[] = ["heading", "body", "mono"];

/** A family name as a site writes it. What is left is what a font URL can carry unescaped. */
export const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/;

const MAX_HREF = 512;
const MAX_ORIGINS = 32;

/** A host, and a port if it has one, for an allow list entry written without a scheme. */
const HOST_PORT = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/i;

/*
 * Saying a stylesheet was refused, once.
 *
 * The head is built on every request of a request-time site, so warning where the refusal happens
 * would put a line in the log for every page view of a setting somebody has to fix once. Same
 * shape as the preset warnings: bounded, and emptied rather than trimmed when it fills, so the
 * messages come back instead of stopping for the life of the process.
 */
const SAID_MAX = 200;
const said = new Set<string>();

function sayOnce(message: string): void {
    if (said.has(message)) return;
    if (said.size >= SAID_MAX) said.clear();
    said.add(message);
    console.warn(message);
}

/** For tests: say every message again. */
export function forgetFontWarnings(): void {
    said.clear();
}

/**
 * A stylesheet URL as a setting may carry it: absolute https, a host, no credentials, and none of
 * the characters that could end the attribute early. Anything else is undefined, and the caller
 * keeps the family name.
 *
 * https only. A font stylesheet over http is blocked as mixed content on every site this serves,
 * so allowing it would only mean rendering a link that never loads.
 */
export function fontStylesheetHref(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const value = v.trim();
    if (!value || value.length > MAX_HREF || /[\s\\<>"'`]/.test(value)) return undefined;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return undefined;
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
    return url.toString();
}

function originOf(value: string): string | undefined {
    const href = fontStylesheetHref(value);
    return href ? new URL(href).origin : undefined;
}

/**
 * The origins this deployment permits, from `PRESS_FONT_ORIGINS`: origins separated by commas or
 * spaces, each `https://host`, a bare host read as https. Unset or blank is Google Fonts alone.
 *
 * A list of its own replaces the default rather than adding to it, so an operator who leaves Google
 * Fonts out stops every link to it, the built-in one included. That is the point for a site that
 * must not hand visitor addresses to a third party: there is no way left to reach it, by settings
 * or otherwise.
 *
 * Read from the environment on each call and never at module scope, because a value read there is
 * baked into whatever is prerendered at build.
 */
export function allowedFontOrigins(
    raw: string | undefined = process.env.PRESS_FONT_ORIGINS,
): ReadonlySet<string> {
    const written = raw?.trim();
    if (!written) return new Set([GOOGLE_FONTS_ORIGIN]);

    const origins = new Set<string>();
    for (const entry of written.split(/[\s,]+/).slice(0, MAX_ORIGINS)) {
        if (!entry) continue;
        // A bare host is read as https. It has to look like a host first: `new URL` reads
        // "https:///fonts" as the host "fonts", so prefixing whatever was written would turn a
        // path into an origin nobody meant to allow.
        const candidate = entry.includes("://") ? entry : HOST_PORT.test(entry) ? `https://${entry}` : entry;
        const origin = originOf(candidate);
        if (origin) origins.add(origin);
        else sayOnce(`fonts: PRESS_FONT_ORIGINS entry "${entry.slice(0, 80)}" is not an https origin, so it was dropped`);
    }
    if (origins.size === 0) sayOnce("fonts: PRESS_FONT_ORIGINS named no https origin, so no font stylesheet is linked");
    return origins;
}

/** The first family of a stack, unquoted. Undefined when it is not a plain family name. */
export function familyOf(stack: string): string | undefined {
    const first = stack.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    return FONT_FAMILY.test(first) ? first : undefined;
}

/** The first family of each role's stack, for a site that loads its faces from Google Fonts. */
export function themeFamilies(theme: PressTheme): string[] {
    const families = FONT_ROLES.map((role) => familyOf(theme.fonts[role])).filter(
        (family): family is string => Boolean(family),
    );
    return [...new Set(families)];
}

function googleFontsHref(family: string): string {
    return `${GOOGLE_FONTS_ORIGIN}/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
}

/** Only the sources a theme carries, for a caller that wants to see what was kept. */
export function fontSourcesFrom(input: ThemeFontSources | undefined): ThemeFontSources | undefined {
    if (!input || typeof input !== "object") return undefined;
    const out: ThemeFontSources = {};
    for (const role of FONT_ROLES) {
        const href = fontStylesheetHref(input[role]);
        if (href) out[role] = href;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

export interface FontHead {
    /** True when a Google Fonts stylesheet is linked, which is what the preconnects are for. */
    google: boolean;
    /** The stylesheets to link, in role order, each once. */
    stylesheets: string[];
}

/**
 * What the head links for a theme.
 *
 * A role with a stylesheet of its own gets it when its origin is allowed. Refused, it falls back to
 * the Google Fonts link for its family name, which is what a role without one has always got, and
 * the refusal is said once. Google Fonts is on the same allow list as everything else.
 */
export function fontLinks(theme: PressTheme, allowed: ReadonlySet<string>): FontHead {
    const googleAllowed = allowed.has(GOOGLE_FONTS_ORIGIN);
    const hrefs: string[] = [];
    let google = false;

    for (const role of FONT_ROLES) {
        const own = theme.fontSources?.[role];
        if (own) {
            const href = fontStylesheetHref(own);
            const origin = href ? new URL(href).origin : undefined;
            if (href && origin && allowed.has(origin)) {
                hrefs.push(href);
                continue;
            }
            sayOnce(
                `fonts: the ${role} stylesheet ${origin ? `at ${origin}` : "url"} is not an origin this deployment allows, ` +
                    "so the family name is used instead. Add it to PRESS_FONT_ORIGINS to load it.",
            );
        }
        const family = familyOf(theme.fonts[role]);
        if (!family || !googleAllowed) continue;
        google = true;
        hrefs.push(googleFontsHref(family));
    }

    return { google, stylesheets: [...new Set(hrefs)] };
}
