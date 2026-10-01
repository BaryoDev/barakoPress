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

    /*
     * barakoPress #101: a long unbroken token (a binding name, a route) had nowhere to break in
     * running text, and pre and table lost their own overflow-x scroller to a flex ancestor that
     * defaults to min-width: auto. Both are geometry, so the real proof is look/viewport.pw.ts;
     * these hold the rules steady at the unit level.
     */
    it("lets inline code wrap, and gives pre and table their own min-width", () => {
        const css = proseCss(DEFAULT_THEME, "s");

        expect(css).toContain("overflow-wrap:anywhere");
        expect(css).toMatch(/\.s pre\{[^}]*overflow-x:auto[^}]*min-width:0/);
        expect(css).toMatch(/\.s table\{[^}]*overflow-x:auto[^}]*min-width:0/);
    });
});

// One rule for the root and one registration for each of the three old font names.
const BRACES = ["{", "}", "{", "}", "{", "}", "{", "}"];

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
        expect(css.match(/[{}]/g)).toEqual(BRACES);
    });

    /*
     * barakoPress #115. The engine's faces are `--bp-font-*`, and `--font-sans`, `--font-display`
     * and `--font-mono` are never declared on the root, because a site's stylesheet owns those
     * names. They are registered with the same value as an initial value instead. Who wins in a
     * browser is look/font-variables.component.pw.ts; this holds the emitted form steady.
     */
    it("declares the faces under the engine's prefix and registers the old names without declaring them", () => {
        const css = themeVariablesCss(resolveTheme({ fonts: { body: "'Inter', sans-serif" } }));
        const root = css.slice(0, css.indexOf("}") + 1);

        expect(root).toContain("--bp-font-sans:'Inter', sans-serif");
        expect(root).toContain(`--bp-font-display:${DEFAULT_THEME.fonts.heading}`);
        expect(root).toContain(`--bp-font-mono:${DEFAULT_THEME.fonts.mono}`);
        expect(root).not.toMatch(/[{;]--font-(sans|display|mono):/);
        expect(css).toContain(`@property --font-sans{syntax:"*";inherits:true;initial-value:'Inter', sans-serif}`);
        expect(css).toContain(`@property --font-display{syntax:"*";inherits:true;initial-value:${DEFAULT_THEME.fonts.heading}}`);
        expect(css).toContain(`@property --font-mono{syntax:"*";inherits:true;initial-value:${DEFAULT_THEME.fonts.mono}}`);
    });

    /*
     * A browser drops a registration whose initial value holds a function or `!important`, and an
     * unclosed quote or a trailing backslash runs on into the next rule. So only a stack of plain
     * and quoted names is registered as written, and anything else registers the default stack.
     */
    it("registers the default stack under the old name when the theme's font is not a plain stack", () => {
        const registered = (name: string, fonts: Parameters<typeof resolveTheme>[0]) =>
            themeVariablesCss(resolveTheme(fonts)).match(new RegExp(`@property ${name}\\{[^}]*initial-value:([^}]*)\\}`))?.[1];

        for (const body of [
            "var(--font-inter), sans-serif",
            "env(x), sans-serif",
            "'Inter', sans-serif !important",
            "'Inter, sans-serif",
            "Inter\\",
            "",
        ]) {
            const css = themeVariablesCss(resolveTheme({ fonts: { body } }));
            expect(css).toContain(`--bp-font-sans:${body}`);
            expect(registered("--font-sans", { fonts: { body } })).toBe(DEFAULT_THEME.fonts.body);
        }

        for (const body of ["Inter", "'Inter', sans-serif", `"Noto Sans JP", '__Inter_5a1b2c', system-ui`, `"Q (x), y", serif`]) {
            expect(registered("--font-sans", { fonts: { body } })).toBe(body);
        }
        expect(registered("--font-mono", { fonts: { mono: "var(--m)" } })).toBe(DEFAULT_THEME.fonts.mono);
        expect(registered("--font-display", { fonts: { heading: "var(--h)" } })).toBe(DEFAULT_THEME.fonts.heading);
    });

    it("strips a font name of what would close the rule or the style element, under both names", () => {
        const css = themeVariablesCss(
            resolveTheme({ fonts: { body: "x;}</style><script>x", heading: "y;} body{color:red} :root{--z:", mono: "z" } }),
        );

        expect(css).not.toContain("<");
        expect(css).not.toContain(">");
        expect(css.match(/[{}]/g)).toEqual(BRACES);
        expect(css.match(/;/g)).toHaveLength(themeVariablesCss(DEFAULT_THEME).match(/;/g)!.length);
        expect(css).toContain("--bp-font-sans:x/stylescriptx;");
        expect(css).toContain("initial-value:x/stylescriptx}");
    });
});
