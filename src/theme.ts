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
    accentTintBorderStrong: string;
    /** Code panels and the footer band. */
    darkPanel: string;
    /** Controls sitting on the dark panel. */
    darkPanelChrome: string;
    darkPanelInk: string;
    darkPanelAccent: string;
    codeGreen: string;
    success: string;
}

export interface ThemeFonts {
    /** Headings and the wordmark. */
    heading: string;
    /** Body and UI. */
    body: string;
    /** Code, meta and labels. The distinction is load bearing: every machine-produced value is mono. */
    mono: string;
}

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
}

export interface PressTheme {
    colors: ThemeColors;
    fonts: ThemeFonts;
    radii: ThemeRadii;
    layout: ThemeLayout;
}

export type PressThemeInput = {
    colors?: Partial<ThemeColors>;
    fonts?: Partial<ThemeFonts>;
    radii?: Partial<ThemeRadii>;
    layout?: Partial<ThemeLayout>;
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
        accentTintBorderStrong: "#C9C1F5",
        darkPanel: "#101223",
        darkPanelChrome: "#2A2C45",
        darkPanelInk: "#DED8FB",
        darkPanelAccent: "#A99BF7",
        codeGreen: "#7BE0C4",
        success: "#0B7A6B",
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
    },
};

export function resolveTheme(input: PressThemeInput | undefined): PressTheme {
    return {
        colors: { ...DEFAULT_THEME.colors, ...input?.colors },
        fonts: { ...DEFAULT_THEME.fonts, ...input?.fonts },
        radii: { ...DEFAULT_THEME.radii, ...input?.radii },
        layout: { ...DEFAULT_THEME.layout, ...input?.layout },
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
        `${s} a{color:${css(c.accent)};font-weight:600;text-decoration:underline;text-underline-offset:2px}`,
        `${s} a:hover{color:${css(c.accentHover)}}`,
        `${s} strong{color:${css(c.ink)};font-weight:700}`,
        // No background on inline code. The handoff calls for it, and a tinted chip inside a
        // 17.5px line is the thing that makes body copy look like documentation.
        `${s} code{font-family:${css(f.mono)};font-size:16px;color:${css(c.ink)}}`,
        `${s} pre{margin:30px 0 0;padding:18px 16px;border-radius:${css(theme.radii.panel)};background:${css(c.darkPanel)};color:${css(c.darkPanelInk)};font-family:${css(f.mono)};font-size:13.5px;line-height:1.85;overflow-x:auto}`,
        `${s} pre code{font-size:inherit;color:inherit}`,
        `${s} blockquote{margin:24px 0 0;padding:2px 0 2px 18px;border-left:2px solid ${css(c.accentTintBorder)};color:${css(c.secondaryInk)}}`,
        `${s} img{max-width:100%;height:auto;border-radius:${css(theme.radii.panel)};border:1px solid ${css(c.hairline)}}`,
        `${s} hr{margin:40px 0 0;border:0;border-top:1px solid ${css(c.hairline)}}`,
        // Its own scroller, so a wide table cannot make the page scroll sideways.
        `${s} table{display:block;overflow-x:auto;width:100%;margin:24px 0 0;border-collapse:collapse;font-size:14.5px}`,
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
    ];
    return `:root{${vars.map(([name, value]) => `${name}:${css(value).replace(/[;{}]/g, "")}`).join(";")}}`;
}
