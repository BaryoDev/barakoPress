import { describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import { DEFAULT_THEME, proseCss, resolveTheme, themeVariablesCss } from "./theme.js";

const SITE = { name: "Test", url: "https://test.example" };

describe("resolveTheme", () => {
    it("returns the defaults when a site configures nothing", () => {
        expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    });

    it("keeps every other colour when one is overridden", () => {
        const theme = resolveTheme({ colors: { accent: "#008060" } });

        expect(theme.colors.accent).toBe("#008060");
        // The claim the nested partial exists for. A flat Partial<PressTheme> would have dropped
        // these, which is how a consumer ends up pasting the whole palette to change one value.
        expect(theme.colors.ink).toBe(DEFAULT_THEME.colors.ink);
        expect(theme.colors.hairline).toBe(DEFAULT_THEME.colors.hairline);
        expect(theme.fonts.heading).toBe(DEFAULT_THEME.fonts.heading);
    });

    it("reaches the config a site actually builds", () => {
        const config = defineConfig({ site: SITE, theme: { layout: { prose: "64ch" } } });

        expect(config.theme.layout.prose).toBe("64ch");
        expect(config.theme.layout.wide).toBe(DEFAULT_THEME.layout.wide);
    });
});

describe("proseCss", () => {
    it("scopes every rule under the class it was given", () => {
        const rules = proseCss(DEFAULT_THEME, "bp-prose").split("}").filter((r) => r.trim());

        expect(rules.length).toBeGreaterThan(15);
        for (const rule of rules) {
            for (const selector of rule.split("{")[0].split(",")) {
                expect(selector.trim().startsWith(".bp-prose")).toBe(true);
            }
        }
    });

    it("renders the body copy from the tokens, not from constants", () => {
        const css = proseCss(resolveTheme({ colors: { proseInk: "#123456" } }), "s");

        expect(css).toContain("#123456");
        expect(css).not.toContain(DEFAULT_THEME.colors.proseInk);
    });

    it("cannot be made to close the style element early", () => {
        // Nobody is expected to put a bracket in a colour. This is here so that a config that
        // somehow carries one produces a broken rule rather than an injected tag.
        const css = proseCss(resolveTheme({ colors: { ink: "</style><script>x()</script>" } }), "s");

        // Only `<`. A `>` is legitimate here: the scoping rules use child selectors.
        expect(css).not.toContain("<");
        expect(css).toContain("/style");
    });
});

describe("themeVariablesCss", () => {
    it("sets the stylesheet's variables from the theme", () => {
        const css = themeVariablesCss(resolveTheme({ colors: { accent: "#17458F" } }));

        expect(css.startsWith(":root{")).toBe(true);
        expect(css).toContain("--primary:#17458F");
        expect(css).not.toContain(DEFAULT_THEME.colors.accent);
    });

    it("cannot be made to close the rule or the style element", () => {
        const css = themeVariablesCss(resolveTheme({ colors: { accent: "red;}</style><script>x()" } }));

        expect(css).not.toContain("<");
        expect(css.match(/[{}]/g)).toEqual(["{", "}"]);
    });
});
