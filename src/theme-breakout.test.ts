import { describe, expect, it } from "vitest";
import { renderProse } from "./assets.js";
import { renderInlineMarkdown } from "./markdown.js";
import { inlineCss } from "./blocks/primitives.js";
import { structuredDataJson } from "./structured-data.js";
import { DEFAULT_THEME, proseCss, resolveTheme, themeVariablesCss, type PressTheme } from "./theme.js";

const BREAKOUT = "red;}</style><script>alert(1)</script>";
const BREAKOUT_SPACED = "red</ style><script>alert(1)</script>";

// What would close a style block or open a script in the middle of one.
const CLOSES_STYLE = /<\s*\/\s*style/i;
const OPENS_SCRIPT = /<\s*script/i;

function expectInert(css: string): void {
    expect(css).not.toMatch(CLOSES_STYLE);
    expect(css).not.toMatch(OPENS_SCRIPT);
    expect(css).not.toContain("<");
}

// A theme built past resolveTheme, with the hostile value in every string slot, so the check is on
// the stylesheet writers and not only on the merge that usually runs first.
function hostileTheme(value: string): PressTheme {
    const colors = Object.fromEntries(Object.keys(DEFAULT_THEME.colors).map((k) => [k, value]));
    return {
        ...DEFAULT_THEME,
        colors: colors as unknown as PressTheme["colors"],
        fonts: { body: value, heading: value, mono: value },
        radii: { ...DEFAULT_THEME.radii, control: value, panel: value },
        tokens: { gap: value },
    };
}

describe("theme css cannot break out of style", () => {
    it("theme css cannot break out of style when a colour closes the block", () => {
        expectInert(themeVariablesCss(hostileTheme(BREAKOUT)));
        expectInert(themeVariablesCss(hostileTheme(BREAKOUT_SPACED)));
    });

    it("theme css cannot break out of style through the merge a site config goes through", () => {
        const theme = resolveTheme({
            colors: { accent: BREAKOUT },
            fonts: { body: BREAKOUT },
            tokens: { gap: BREAKOUT },
        });

        expectInert(themeVariablesCss(theme));
        expectInert(proseCss(theme, "prose"));
        expectInert(inlineCss(theme));
    });

    it("prose css cannot break out of style when a colour or font closes the block", () => {
        expectInert(proseCss(hostileTheme(BREAKOUT), "prose"));
    });

    it("inline css cannot break out of style when a colour or font closes the block", () => {
        expectInert(inlineCss(hostileTheme(BREAKOUT)));
    });

    it("theme css cannot break out of style through a token, tone or variant name", () => {
        const theme = resolveTheme({
            tokens: { [BREAKOUT]: "#ff0000", [BREAKOUT_SPACED]: "#ff0000" },
            tones: { [BREAKOUT]: { ink: "#000000", bg: "#ffffff", edge: "#cccccc" } },
            variants: { [BREAKOUT]: { accent: "#ff0000" } },
        } as Parameters<typeof resolveTheme>[0]);

        expectInert(themeVariablesCss(theme));
        expectInert(proseCss(theme, "prose"));
        expectInert(inlineCss(theme));
    });
});

describe("tenant prose cannot open a script or close a style", () => {
    const PROSE = `Hello </style><script>alert(1)</script> <img src=x onerror=alert(1)>\n\n\`</script>\`\n\n[x](javascript:alert(1))`;

    it("renders block prose with raw markup escaped", () => {
        const html = renderProse(PROSE, DEFAULT_THEME);

        expect(html).not.toMatch(OPENS_SCRIPT);
        expect(html).not.toMatch(CLOSES_STYLE);
        expect(html).not.toMatch(/<img/i);
        expect(html).not.toMatch(/href="javascript:/i);
    });

    it("renders inline text with raw markup escaped", () => {
        const html = renderInlineMarkdown(PROSE);

        expect(html).not.toMatch(OPENS_SCRIPT);
        expect(html).not.toMatch(CLOSES_STYLE);
        expect(html).not.toMatch(/<img/i);
    });

    it("writes structured data so a closing script tag cannot end the element early", () => {
        const json = structuredDataJson({ name: "</script><script>alert(1)</script>" });

        expect(json).not.toBeNull();
        expect(json).not.toContain("<");
        expect(JSON.parse(json as string).name).toBe("</script><script>alert(1)</script>");
    });
});
