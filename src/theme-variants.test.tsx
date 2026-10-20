import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeVariantSwitch, variantScript, VariantScript } from "./screens/theme-variants.js";
import { DEFAULT_THEME, resolveTheme, themeVariablesCss, variantsFrom } from "./theme.js";

/*
 * Theme variants: named overrides of colour slots, switched in the browser (#80). The page is the
 * same for every visitor, so none of this may depend on a request.
 */

const DARK = { dark: { pageBg: "#101010", ink: "#f5f5f5", accent: "#66aaff" } };

describe("theme variants", () => {
    it("leaves a theme with no variants exactly as it was", () => {
        const theme = resolveTheme(undefined);

        expect(theme).toEqual(DEFAULT_THEME);
        expect(theme.variants).toBeUndefined();
        expect(themeVariablesCss(theme)).toBe(themeVariablesCss(DEFAULT_THEME));
        expect(themeVariablesCss(theme)).not.toContain("data-theme-variant");
        expect(variantScript(theme)).toBeNull();
        expect(renderToStaticMarkup(<VariantScript theme={theme} />)).toBe("");
        expect(renderToStaticMarkup(<ThemeVariantSwitch theme={theme} />)).toBe("");
    });

    it("writes each variant as a rule keyed on the root attribute, after the base rule", () => {
        const css = themeVariablesCss(resolveTheme({ variants: DARK }));

        const base = css.indexOf(":root{");
        const dark = css.indexOf(':root[data-theme-variant="dark"]{');
        expect(base).toBe(0);
        expect(dark).toBeGreaterThan(base);
        const rule = css.slice(dark, css.indexOf("}", dark));
        expect(rule).toContain("--background:#101010");
        expect(rule).toContain("--foreground:#f5f5f5");
        expect(rule).toContain("--primary:#66aaff");
        // A slot the variant does not name keeps the base colour.
        expect(rule).toContain(`--border:${DEFAULT_THEME.colors.hairline}`);
    });

    it("keeps the base theme's own colours when variants are named", () => {
        const theme = resolveTheme({ variants: DARK });

        expect(theme.colors).toEqual(DEFAULT_THEME.colors);
    });

    it("drops names, slots and colours it cannot trust", () => {
        const variants = variantsFrom(undefined, {
            "Bad Name": { accent: "#fff" },
            'x"]{}</style>': { accent: "#fff" },
            ok: { accent: "red;}</style>", nonsense: "#fff", ink: "#000" },
            empty: { accent: "not a colour!" },
            notAnObject: "#fff",
        });

        expect(Object.keys(variants ?? {})).toEqual(["ok"]);
        expect(variants?.ok).toEqual({ ink: "#000" });
    });

    it("lets a tenant replace a configured variant by name and add others", () => {
        const base = resolveTheme({ variants: DARK }).variants;
        const merged = variantsFrom(base, { dark: { ink: "#fff" }, sepia: { pageBg: "#f4ecd8" } });

        expect(Object.keys(merged ?? {}).sort()).toEqual(["dark", "sepia"]);
        expect(merged?.dark).toEqual({ ink: "#fff" });
    });

    it("keeps the configured variants when the tenant names none", () => {
        const base = resolveTheme({ variants: DARK }).variants;

        expect(variantsFrom(base, undefined)).toEqual(base);
        expect(variantsFrom(base, { dark: { accent: "nope!" } })).toEqual(base);
    });

    it("caps how many a tenant can name", () => {
        const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`v${i}`, { accent: "#fff" }]));

        expect(Object.keys(variantsFrom(undefined, many) ?? {})).toHaveLength(12);
    });

    it("puts the switch in the head as a script that depends on nothing per request", () => {
        const theme = resolveTheme({ variants: DARK });
        const source = variantScript(theme);

        expect(source).not.toBeNull();
        expect(source).toContain('["dark"]');
        expect(source).toContain("localStorage");
        expect(source).toContain("press-theme-variant");
        expect(source).not.toContain("cookie");
        expect(renderToStaticMarkup(<VariantScript theme={theme} />)).toContain("<script>");
    });

    it("renders a control for the base theme and one per variant", () => {
        const html = renderToStaticMarkup(
            <ThemeVariantSwitch theme={resolveTheme({ variants: { ...DARK, sepia: { pageBg: "#f4ecd8" } } })} />,
        );

        expect(html).toContain('data-theme-variant-set=""');
        expect(html).toContain('data-theme-variant-set="dark"');
        expect(html).toContain('data-theme-variant-set="sepia"');
        expect(html.match(/<button/g)).toHaveLength(3);
    });
});
