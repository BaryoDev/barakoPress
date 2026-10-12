import type { CSSProperties } from "react";
import type { PressTheme } from "../theme.js";
import type { HeaderLinkStyles } from "./header-menu.js";

/*
 * The header links' looks and the rules an inline style cannot say, shared by the built-in header
 * and the `siteNavigation` block. Not in header-menu.tsx: a value a server component imports from a
 * client module arrives as a client reference, not as the value.
 *
 * No colour in the rules; every colour is inline, from the theme.
 */

export const CURRENT_CSS = ".bp-current{font-weight:700}";

/* Before hydration a dropdown opens on hover and on focus inside it; after, on `data-open`. */
export const DROPDOWN_CSS =
    ".bp-dropdown>ul{display:none}" +
    ".bp-dropdown:not([data-js]):hover>ul,.bp-dropdown:not([data-js]):focus-within>ul,.bp-dropdown[data-open]>ul{display:block}";

export function headerLinkStyles(t: PressTheme, link: CSSProperties, badge: CSSProperties): HeaderLinkStyles {
    const c = t.colors;
    return {
        link,
        badge,
        dropdown: { position: "relative", display: "inline-flex", alignItems: "center", gap: "2px" },
        toggle: {
            display: "inline-flex",
            alignItems: "center",
            padding: "4px",
            margin: 0,
            border: 0,
            background: "none",
            color: "inherit",
            font: "inherit",
            cursor: "pointer",
        },
        menu: {
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 50,
            minWidth: "12rem",
            margin: 0,
            padding: "6px 0",
            listStyle: "none",
            background: c.surface,
            color: c.ink,
            border: `1px solid ${c.hairline}`,
            borderRadius: t.radii.panel,
        },
        menuLink: { ...link, display: "block", padding: "8px 14px", whiteSpace: "nowrap" },
    };
}

