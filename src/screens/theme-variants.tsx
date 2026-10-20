import type { CSSProperties, ReactNode } from "react";
import { VARIANT_ATTRIBUTE, type PressTheme } from "../theme.js";

/*
 * The client-side switch for theme variants.
 *
 * Nothing here is per visitor on the server. The page is rendered once, with every variant's
 * colours in the stylesheet, so it stays in the shared render cache. A small script in the head
 * reads the visitor's choice from localStorage before the body paints and sets one attribute on the
 * root element; the stylesheet does the rest. A control is any element carrying
 * `data-theme-variant-set="<name>"`, and an empty name goes back to the base theme.
 */

export const VARIANT_STORAGE_KEY = "press-theme-variant";
export const VARIANT_SET_ATTRIBUTE = `${VARIANT_ATTRIBUTE}-set`;

/** The script for a theme, or null when the theme names no variants. Names are already plain words. */
export function variantScript(theme: PressTheme): string | null {
    const names = Object.keys(theme.variants ?? {});
    if (names.length === 0) return null;
    const list = JSON.stringify(names);
    const attr = JSON.stringify(VARIANT_ATTRIBUTE);
    const control = JSON.stringify(`[${VARIANT_SET_ATTRIBUTE}]`);
    const key = JSON.stringify(VARIANT_STORAGE_KEY);
    return (
        `(function(){var n=${list},k=${key},a=${attr},d=document.documentElement;` +
        `function s(v){if(v&&n.indexOf(v)>-1)d.setAttribute(a,v);else d.removeAttribute(a)}` +
        `try{s(localStorage.getItem(k))}catch(e){}` +
        `document.addEventListener("click",function(e){var t=e.target&&e.target.closest&&e.target.closest(${control});` +
        `if(!t)return;var v=t.getAttribute(${JSON.stringify(VARIANT_SET_ATTRIBUTE)})||"";s(v);` +
        `try{if(v&&n.indexOf(v)>-1)localStorage.setItem(k,v);else localStorage.removeItem(k)}catch(x){}})})()`
    );
}

export function VariantScript({ theme }: { theme: PressTheme }) {
    const source = variantScript(theme);
    return source ? <script dangerouslySetInnerHTML={{ __html: source }} /> : null;
}

/**
 * One button per variant, and one for the base theme. Renders nothing when the theme has no
 * variants, so a site can place it in its layout before any tenant names one.
 */
export function ThemeVariantSwitch({
    theme,
    baseLabel = "Default",
    labels,
    style,
}: {
    theme: PressTheme;
    baseLabel?: string;
    labels?: Readonly<Record<string, string>>;
    style?: CSSProperties;
}): ReactNode {
    const names = Object.keys(theme.variants ?? {});
    if (names.length === 0) return null;
    return (
        <div role="group" aria-label="Theme" style={style}>
            {[["", baseLabel] as const, ...names.map((name) => [name, labels?.[name] ?? name] as const)].map(
                ([name, label]) => (
                    <button key={name} type="button" {...{ [VARIANT_SET_ATTRIBUTE]: name }}>
                        {label}
                    </button>
                ),
            )}
        </div>
    );
}
