import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Asset, renderProse } from "../assets.js";
import type { PressConfig } from "../config.js";
import type { PressTheme } from "../theme.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
import {
    HIDDEN_CLASS,
    HUE_STEPS,
    countTarget,
    countUpCss,
    hueCss,
    linesOf,
    motionClass,
    revealCss,
    rotatingCss,
    typingCss,
} from "./motion.js";
import {
    type Tone,
    ALIGNMENTS,
    RADII,
    SPACES,
    TEXT_VARIANTS,
    TEXT_VARIANT_NAMES,
    TONES,
    WIDTHS,
    alignOf,
    radiusOf,
    spaceOf,
    textAlignOf,
    toneOf,
    widthOf,
} from "./tokens.js";

/*
 * Layer 1 and layer 2 of barakoPress #33: the parts a page is assembled from.
 *
 * Layout primitives hold blocks and no content. Content primitives hold content and no layout. Each
 * one takes theme tokens (a tone, a space name, a text role, a radius name) and never a colour or a
 * pixel value, so a page a designer assembles in barakoBrew cannot drift from the site's design and
 * a tenant restyles every page by changing the theme.
 *
 * Styled inline for the reason the screens are: `barakopress/styles.css` is opt-in, and a look that
 * depends on an import the consumer may not make is a look somebody does not get.
 */

/** The class the page's generated body stylesheet is scoped to, shared with the markdown block. */
export const PROSE_CLASS = "bp-prose";

const toneSelect = { kind: "select" as const, options: [...TONES] };
const spaceSelect = { kind: "select" as const, options: [...SPACES] };
const alignSelect = { kind: "select" as const, options: [...ALIGNMENTS] };

function gap(theme: PressTheme, name: string | undefined, fallback: Parameters<typeof spaceOf>[2] = "md"): string {
    return spaceOf(theme, name, fallback);
}

/*
 * A tone is the band's, and everything inside the band takes it.
 *
 * A `section` sets its own background and ink, but the content primitives inside it resolved their
 * colours against the page tone, so a heading in an inverse band was dark ink on a dark panel. They
 * are drawn from a custom property instead, set by the nearest band or panel and falling back to the
 * page tone, which is what a block standing on its own still gets. It is inheritance because that is
 * the shape of the problem: a block does not know what it was dropped into, and CSS does.
 */
const TONE_VARS = {
    ink: "--bp-ink",
    secondaryInk: "--bp-ink-soft",
    muted: "--bp-muted",
    hairline: "--bp-hairline",
    accent: "--bp-accent",
    onAccent: "--bp-on-accent",
} as const satisfies Partial<Record<keyof Tone, string>>;

type ToneVar = keyof typeof TONE_VARS;

function inherited(theme: PressTheme, key: ToneVar): string {
    return `var(${TONE_VARS[key]}, ${toneOf(theme, undefined)[key]})`;
}

function toneVars(tone: Tone): CSSProperties {
    const style: Record<string, string> = {};
    for (const [key, name] of Object.entries(TONE_VARS)) style[name] = tone[key as ToneVar];
    return style as CSSProperties;
}

/* ---------------------------------------------------------------- layout */

type SectionProps = { tone?: string; width?: string; padding?: string; align?: string };

const section = defineBlock<SectionProps, "content">({
    type: "section",
    label: "Section",
    layer: "primitive",
    fields: [
        { name: "tone", label: "Tone", ...toneSelect },
        { name: "width", label: "Width", kind: "select", options: [...WIDTHS] },
        { name: "padding", label: "Padding", ...spaceSelect },
        { name: "align", label: "Align", ...alignSelect },
        { name: "content", kind: "slots", label: "Content", min: 1, max: 1 },
    ],
    component: ({ props, slots, theme }) => {
        const tone = toneOf(theme, props.tone);
        const inner = widthOf(theme, props.width);
        return (
            <section
                style={{
                    ...toneVars(tone),
                    background: tone.bg,
                    color: tone.ink,
                    paddingTop: spaceOf(theme, props.padding, "xl"),
                    paddingBottom: spaceOf(theme, props.padding, "xl"),
                    paddingLeft: theme.layout.gutter,
                    paddingRight: theme.layout.gutter,
                    textAlign: textAlignOf(props.align),
                }}
            >
                <div style={{ maxWidth: inner, margin: inner ? "0 auto" : undefined }}>{slots.content?.[0]}</div>
            </section>
        );
    },
});

type StackProps = { gap?: string; align?: string };

const stack = defineBlock<StackProps, "content">({
    type: "stack",
    label: "Stack",
    layer: "primitive",
    fields: [
        { name: "gap", label: "Gap", ...spaceSelect },
        { name: "align", label: "Align", ...alignSelect },
        { name: "content", kind: "slots", label: "Content", min: 1, max: 1 },
    ],
    component: ({ props, slots, theme }) => (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: gap(theme, props.gap),
                alignItems: props.align ? alignOf(props.align) : "stretch",
            }}
        >
            {slots.content?.[0]}
        </div>
    ),
});

type RowProps = { gap?: string; align?: string; justify?: string };

/*
 * Side by side, wrapping onto its own line below `layout.columnMin`. `flex-wrap` and a basis rather
 * than a media query, because a block does not know how wide the column it was dropped into is.
 */
const row = defineBlock<RowProps, "items">({
    type: "row",
    label: "Row",
    layer: "primitive",
    fields: [
        { name: "gap", label: "Gap", ...spaceSelect },
        { name: "align", label: "Align", ...alignSelect },
        {
            name: "justify",
            label: "Distribute",
            kind: "select",
            options: ["start", "center", "end", "between"],
        },
        { name: "items", kind: "slots", label: "Items", required: true, min: 1, max: 8 },
    ],
    component: ({ props, slots, theme }) => (
        <div
            style={{
                display: "flex",
                flexWrap: "wrap",
                gap: gap(theme, props.gap),
                alignItems: props.align ? alignOf(props.align) : "stretch",
                justifyContent: props.justify === "between" ? "space-between" : alignOf(props.justify),
            }}
        >
            {(slots.items ?? []).map((item, i) => (
                <div key={i} style={{ flex: `1 1 min(100%, ${theme.layout.columnMin})`, minWidth: 0 }}>
                    {item}
                </div>
            ))}
        </div>
    ),
});

type GridProps = { columns?: number; gap?: string };

const grid = defineBlock<GridProps, "items">({
    type: "grid",
    label: "Grid",
    layer: "primitive",
    fields: [
        { name: "columns", kind: "number", label: "Columns", min: 1, max: 6 },
        { name: "gap", label: "Gap", ...spaceSelect },
        { name: "items", kind: "slots", label: "Items", required: true, min: 1, max: 24 },
    ],
    component: ({ props, slots, theme }) => (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: `repeat(${props.columns ?? 2}, minmax(min(100%, ${theme.layout.columnMin}), 1fr))`,
                gap: gap(theme, props.gap),
            }}
        >
            {(slots.items ?? []).map((item, i) => (
                <div key={i} style={{ minWidth: 0 }}>
                    {item}
                </div>
            ))}
        </div>
    ),
});

type FlowProps = { columns?: string; gap?: string; align?: string; justify?: string; hueRotate?: string };

/** How many columns a flow may ask for. A choice and not a number, for the reason below. */
export const FLOW_COLUMNS = ["auto", "1", "2", "3", "4", "5", "6"];

/*
 * Blocks side by side, from one list rather than one list per cell.
 *
 * `row` and `grid` take a list per cell, which is right when a designer places each cell. It cannot
 * express the other two cases: a `repeat` that turns one subtree into however many rows came back,
 * and a preset's `slot`, which hands over a list whose length nobody knows when the preset is
 * written. Both of those produce siblings in one list, and until now siblings in one list could
 * only stack. So a `flow` lays its list out instead of stacking it.
 *
 * The column count is a choice and not a number because a number field cannot carry a binding: a
 * preset that exposes "how many columns" has to pass its own prop through to this one, and only a
 * string field takes `{{props.columns}}`.
 */
const flow = defineBlock<FlowProps, "content">({
    type: "flow",
    label: "Flow",
    layer: "primitive",
    fields: [
        { name: "columns", kind: "select", label: "Columns", options: FLOW_COLUMNS },
        { name: "gap", label: "Gap", ...spaceSelect },
        { name: "align", label: "Align", ...alignSelect },
        {
            name: "justify",
            label: "Distribute",
            kind: "select",
            options: ["start", "center", "end", "between"],
        },
        { name: "hueRotate", kind: "select", label: "Rotate cell hues", options: HUE_STEPS },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: ({ props, slots, theme }) => {
        const columns = Number(props.columns);
        const asGrid = Number.isInteger(columns) && columns >= 1;
        const style = {
            // Takes the wrapper the list renders out of the box tree, so the blocks in it are the
            // cells here. See render.tsx.
            "--bp-list": "contents",
            display: asGrid ? "grid" : "flex",
            flexWrap: asGrid ? undefined : "wrap",
            gridTemplateColumns: asGrid
                ? `repeat(${columns}, minmax(min(100%, ${theme.layout.columnMin}), 1fr))`
                : undefined,
            gap: gap(theme, props.gap),
            alignItems: props.align ? alignOf(props.align) : "stretch",
            justifyContent: props.justify === "between" ? "space-between" : alignOf(props.justify),
        } as CSSProperties;
        const hue = hueCss(props.hueRotate ?? "none");
        return (
            <>
                {hue && <style dangerouslySetInnerHTML={{ __html: hue }} />}
                <div style={style} data-bp-hue={hue ? props.hueRotate : undefined}>
                    {slots.content?.[0]}
                </div>
            </>
        );
    },
});

type PanelProps = {
    tone?: string;
    padding?: string;
    radius?: string;
    border?: boolean;
    align?: string;
    width?: string;
};

/*
 * A box with a background of its own: the card in a card grid, the panel a table of facts sits in.
 *
 * `section` is the band across the page, gutters and all, and stacking two of them is not a card.
 * The frame is on unless a block turns it off, the same bargain the image primitive made, and the
 * height is full so cards in one row of a flow end level with each other.
 */
const panel = defineBlock<PanelProps, "content">({
    type: "panel",
    label: "Panel",
    layer: "primitive",
    fields: [
        { name: "tone", label: "Tone", ...toneSelect },
        { name: "padding", label: "Padding", ...spaceSelect },
        { name: "radius", kind: "select", label: "Corners", options: [...RADII] },
        { name: "border", kind: "boolean", label: "Hairline frame" },
        { name: "align", label: "Align", ...alignSelect },
        { name: "width", kind: "select", label: "Width", options: [...WIDTHS] },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: ({ props, slots, theme }) => {
        const tone = toneOf(theme, props.tone ?? "surface");
        const inner = widthOf(theme, props.width ?? "full");
        return (
            <div
                style={{
                    ...toneVars(tone),
                    boxSizing: "border-box",
                    height: "100%",
                    maxWidth: inner,
                    margin: inner ? "0 auto" : undefined,
                    padding: spaceOf(theme, props.padding, "lg"),
                    background: tone.bg,
                    color: tone.ink,
                    borderRadius: radiusOf(theme, props.radius ?? "panel"),
                    border: props.border === false ? undefined : `1px solid ${tone.hairline}`,
                    textAlign: textAlignOf(props.align),
                }}
            >
                {slots.content?.[0]}
            </div>
        );
    },
});

const spacer = defineBlock<{ size?: string }>({
    type: "spacer",
    label: "Spacer",
    layer: "primitive",
    fields: [{ name: "size", label: "Size", ...spaceSelect }],
    component: ({ props, theme }) => <div style={{ height: spaceOf(theme, props.size, "lg") }} />,
});

const divider = defineBlock<{ tone?: string; space?: string }>({
    type: "divider",
    label: "Divider",
    layer: "primitive",
    fields: [
        { name: "tone", label: "Tone", ...toneSelect },
        { name: "space", label: "Space around", ...spaceSelect },
    ],
    component: ({ props, theme }) => (
        <hr
            style={{
                border: 0,
                borderTop: `1px solid ${
                    props.tone ? toneOf(theme, props.tone).hairline : inherited(theme, "hairline")
                }`,
                margin: `${spaceOf(theme, props.space, "lg")} 0`,
            }}
        />
    ),
});

/* --------------------------------------------------------------- content */

type TextProps = { value: string; variant?: string; tone?: string; align?: string; weight?: string; motion?: string };

const INK: Record<string, ToneVar> = {
    ink: "ink",
    secondary: "secondaryInk",
    muted: "muted",
    accent: "accent",
};

/** What a text block can do besides sit there. A select, so a preset can pass its own prop through. */
export const TEXT_MOTIONS = ["none", "countUp"];

const text = defineBlock<TextProps>({
    type: "text",
    label: "Text",
    layer: "primitive",
    fields: [
        { name: "value", kind: "text", label: "Text", required: true },
        { name: "variant", kind: "select", label: "Variant", options: TEXT_VARIANT_NAMES },
        { name: "tone", kind: "select", label: "Ink", options: Object.keys(INK) },
        { name: "align", label: "Align", ...alignSelect },
        { name: "weight", kind: "select", label: "Weight", options: ["regular", "medium", "bold"] },
        { name: "motion", kind: "select", label: "Motion", options: TEXT_MOTIONS },
    ],
    component: ({ props, theme }) => {
        const variant = TEXT_VARIANTS[props.variant ?? "body"] ?? TEXT_VARIANTS.body;
        const Tag = variant.tag;
        const heading = Tag !== "p";
        const style: CSSProperties = {
            margin: 0,
            fontFamily: variant.role === "meta" ? theme.fonts.mono : heading ? theme.fonts.heading : theme.fonts.body,
            fontSize: theme.text[variant.role],
            lineHeight: heading ? 1.15 : 1.7,
            letterSpacing: heading ? "-.03em" : undefined,
            fontWeight: props.weight === "bold" ? 700 : props.weight === "regular" ? 400 : heading ? 600 : 400,
            color: inherited(theme, INK[props.tone ?? ""] ?? (heading ? "ink" : "secondaryInk")),
            textAlign: textAlignOf(props.align),
            textWrap: heading ? "balance" : "pretty",
        };
        /*
         * A figure counts up to what is already written here. The number stays the element's own
         * text, so a browser that runs no animation, and a visitor who asked for none, read the
         * figure itself rather than an empty box waiting for a script that is not coming.
         *
         * Two copies, because while the count runs the drawn figure is covered and the counter over
         * it is generated content, which is not a value anything reads out. The drawn one is
         * presentational either way and the off-screen one is the figure, so what is read is the
         * same whether the count runs or not.
         */
        const to = props.motion === "countUp" ? countTarget(props.value) : null;
        if (to === null) return <Tag style={style}>{props.value}</Tag>;
        const cls = motionClass("cu", to);
        return (
            <>
                <style dangerouslySetInnerHTML={{ __html: countUpCss(cls, to) }} />
                <Tag style={style} className={cls}>
                    <span className={HIDDEN_CLASS}>{props.value}</span>
                    <span data-bp-counted aria-hidden="true">{props.value}</span>
                </Tag>
            </>
        );
    },
});


/*
 * The markdown primitive is `richText`, the name stored pages already use, and its field is still
 * `markdown`. A primitive under a new name would have meant migrating every page that has one for
 * nothing: this is the same block, with a width token added.
 *
 * Rendered markdown is a string of HTML, the one thing an inline style cannot reach, so a page that
 * holds one emits `proseCss` for this class.
 */
const richText = defineBlock<{ markdown: string; width?: string }>({
    type: "richText",
    label: "Rich text",
    layer: "primitive",
    fields: [
        { name: "markdown", kind: "markdown", label: "Text", required: true },
        { name: "width", kind: "select", label: "Width", options: [...WIDTHS] },
    ],
    component: ({ props, theme }) => (
        <div
            className={PROSE_CLASS}
            style={{ maxWidth: widthOf(theme, props.width ?? "prose") }}
            dangerouslySetInnerHTML={{ __html: renderProse(props.markdown, theme) }}
        />
    ),
});

type ImageProps = {
    src: string;
    alt?: string;
    caption?: string;
    radius?: string;
    width?: string;
    frame?: boolean;
    asSupplied?: boolean;
    clearSpace?: string;
};

/*
 * Also the `image` that shipped in 0.3.0, which is why the frame is on unless a block turns it off:
 * a page stored before the primitives existed carries src, alt and caption and nothing else, and it
 * still renders a framed, rounded, captioned figure. `radius`, `width` and `frame` are the new
 * tokens, all optional, and the caption gap now comes off the spacing scale.
 *
 * `asSupplied` marks this one image, for a mark the site has not listed. Marked either way, the
 * corner, the frame and anything else this block asks for are dropped rather than applied: a block
 * that cannot honour the rule draws the mark alone (#29).
 */
const image = defineBlock<ImageProps>({
    type: "image",
    label: "Image",
    layer: "primitive",
    fields: [
        { name: "src", kind: "url", label: "Image URL", required: true },
        { name: "alt", kind: "text", label: "Alternative text" },
        { name: "caption", kind: "text", label: "Caption" },
        { name: "radius", kind: "select", label: "Corners", options: [...RADII] },
        { name: "width", kind: "select", label: "Width", options: [...WIDTHS] },
        { name: "frame", kind: "boolean", label: "Hairline frame" },
        { name: "asSupplied", kind: "boolean", label: "Use exactly as supplied" },
        { name: "clearSpace", kind: "select", label: "Clear space", options: [...SPACES] },
    ],
    component: ({ props, theme }) => (
        <figure style={{ margin: 0, maxWidth: widthOf(theme, props.width ?? "full") }}>
            <Asset
                src={props.src}
                alt={props.alt}
                theme={theme}
                loading="lazy"
                supplied={{ asSupplied: props.asSupplied, clearSpace: props.clearSpace }}
                style={{
                    display: "block",
                    maxWidth: "100%",
                    height: "auto",
                    borderRadius: radiusOf(theme, props.radius ?? "panel"),
                    border: props.frame === false ? undefined : `1px solid ${theme.colors.hairline}`,
                }}
            />
            {props.caption && (
                <figcaption
                    style={{
                        marginTop: theme.space.xs,
                        fontFamily: theme.fonts.mono,
                        fontSize: theme.text.meta,
                        color: theme.colors.muted,
                    }}
                >
                    {props.caption}
                </figcaption>
            )}
        </figure>
    ),
});

type VideoProps = { src: string; poster?: string; caption?: string; radius?: string; autoplay?: boolean };

const video = defineBlock<VideoProps>({
    type: "video",
    label: "Video",
    layer: "primitive",
    fields: [
        { name: "src", kind: "url", label: "Video URL", required: true },
        { name: "poster", kind: "url", label: "Poster image" },
        { name: "caption", kind: "text", label: "Caption" },
        { name: "radius", kind: "select", label: "Corners", options: [...RADII] },
        { name: "autoplay", kind: "boolean", label: "Play muted on view" },
    ],
    component: ({ props, theme }) => (
        <figure style={{ margin: 0 }}>
            <video
                src={props.src}
                poster={props.poster}
                controls
                playsInline
                preload="metadata"
                // Autoplay is muted and looping or it is not autoplay: a video that makes noise on
                // its own is the thing everyone leaves the page over.
                autoPlay={props.autoplay === true}
                muted={props.autoplay === true}
                loop={props.autoplay === true}
                style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                    borderRadius: radiusOf(theme, props.radius ?? "panel"),
                    background: theme.colors.inverse,
                }}
            />
            {props.caption && (
                <figcaption
                    style={{ marginTop: theme.space.xs, fontSize: theme.text.meta, color: theme.colors.muted }}
                >
                    {props.caption}
                </figcaption>
            )}
        </figure>
    ),
});

const ASPECTS: Record<string, string> = { "16:9": "16 / 9", "4:3": "4 / 3", "1:1": "1 / 1" };

/*
 * An iframe is the one block that hands a third party a frame inside the page, so the host is held
 * to the site's allow list (`config.embedHosts`) and the frame is sandboxed. The allow list is
 * configuration rather than a literal here: which players a site trusts is the site's decision.
 */
function embed(config: PressConfig): BlockDefinition {
    const allowed = new Set(config.embedHosts.map((h) => h.toLowerCase()));
    return defineBlock<{ src: string; title: string; aspect?: string; radius?: string }>({
        type: "embed",
        label: "Embed",
        layer: "primitive",
        fields: [
            { name: "src", kind: "url", label: "Embed URL", required: true },
            { name: "title", kind: "text", label: "What it is", required: true },
            { name: "aspect", kind: "select", label: "Shape", options: Object.keys(ASPECTS) },
            { name: "radius", kind: "select", label: "Corners", options: [...RADII] },
        ],
        component: ({ props, theme }) => {
            let url: URL;
            try {
                url = new URL(props.src);
            } catch {
                return null;
            }
            if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase())) return null;
            return (
                <iframe
                    src={url.toString()}
                    title={props.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    allowFullScreen
                    style={{
                        display: "block",
                        width: "100%",
                        aspectRatio: ASPECTS[props.aspect ?? "16:9"] ?? ASPECTS["16:9"],
                        border: 0,
                        borderRadius: radiusOf(theme, props.radius ?? "panel"),
                    }}
                />
            );
        },
    });
}

/*
 * A small set of shapes, drawn from paths here rather than loaded from anywhere, so an icon costs
 * no request and no third party. Generic marks only: a client's own mark is an image.
 */
export const ICONS: Record<string, string> = {
    arrow: "M4 12h15m0 0-6-6m6 6-6 6",
    check: "M4 12.5l5 5L20 6.5",
    close: "M6 6l12 12M18 6L6 18",
    plus: "M12 5v14M5 12h14",
    info: "M12 11v6m0-10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    warning: "M12 9v4m0 4h.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
    star: "M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 10l6.1-.9z",
    mail: "M3 7l9 6 9-6M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z",
    phone: "M6 3h3l2 5-2.5 1.5a12 12 0 006 6L16 13l5 2v3a2 2 0 01-2 2A16 16 0 014 5a2 2 0 012-2z",
    location: "M12 21s7-5.7 7-11a7 7 0 10-14 0c0 5.3 7 11 7 11zm0-8.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z",
    calendar: "M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z",
    clock: "M12 7v5l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
    link: "M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1m-1 8a5 5 0 01-7.5.5l-2-2a5 5 0 017-7l1 1",
};

const ICON_SIZES: Record<string, keyof PressTheme["text"]> = {
    sm: "small",
    md: "lead",
    lg: "display",
};

/**
 * One of `ICONS`, drawn outside a block: an option's style puts one on a card (#52). A name the
 * engine does not have draws nothing, the same as the icon block.
 */
export function IconGlyph({ name, size, color }: { name: string; size: string; color: string }) {
    const path = ICONS[name];
    if (!path) return null;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            stroke={color}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            style={{ display: "inline-block", verticalAlign: "middle" }}
        >
            <path d={path} />
        </svg>
    );
}

const icon = defineBlock<{ name: string; size?: string; tone?: string; label?: string }>({
    type: "icon",
    label: "Icon",
    layer: "primitive",
    fields: [
        { name: "name", kind: "select", label: "Icon", required: true, options: Object.keys(ICONS) },
        { name: "size", kind: "select", label: "Size", options: Object.keys(ICON_SIZES) },
        { name: "tone", kind: "select", label: "Ink", options: Object.keys(INK) },
        { name: "label", kind: "text", label: "Read out as" },
    ],
    component: ({ props, theme }) => {
        const path = ICONS[props.name];
        if (!path) return null;
        const size = theme.text[ICON_SIZES[props.size ?? "md"] ?? "lead"];
        return (
            <svg
                viewBox="0 0 24 24"
                width={size}
                height={size}
                fill="none"
                stroke={inherited(theme, INK[props.tone ?? ""] ?? "accent")}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                role={props.label ? "img" : undefined}
                aria-hidden={props.label ? undefined : true}
                aria-label={props.label}
                style={{ display: "inline-block", verticalAlign: "middle" }}
            >
                <path d={path} />
            </svg>
        );
    },
});

type LinkProps = { label: string; href: string; variant?: string; size?: string; newTab?: boolean };

const BUTTON_VARIANTS = ["primary", "secondary", "quiet"];

function linkStyle(theme: PressTheme, variant: string, size: string): CSSProperties {
    const pad = size === "lg" ? `${theme.space.sm} ${theme.space.md}` : `${theme.space.xs} ${theme.space.sm}`;
    const base: CSSProperties = {
        display: "inline-block",
        padding: pad,
        borderRadius: theme.radii.control,
        fontWeight: 600,
        fontSize: size === "lg" ? theme.text.body : theme.text.small,
        textDecoration: "none",
    };
    const accent = inherited(theme, "accent");
    if (variant === "secondary") {
        return {
            ...base,
            background: "transparent",
            color: accent,
            border: `1px solid ${inherited(theme, "hairline")}`,
        };
    }
    if (variant === "quiet") {
        return { ...base, padding: 0, background: "transparent", color: accent, textDecoration: "underline" };
    }
    return {
        ...base,
        background: accent,
        color: inherited(theme, "onAccent"),
        border: "1px solid transparent",
    };
}

/*
 * One component behind `button` and `link`. They are two block types because an editor picking a
 * part thinks in those words, and the same because a button that navigates is a link: rendering one
 * as a <button> would give a control that does nothing without JavaScript.
 */
function anchorBlock(type: string, label: string, defaultVariant: string): BlockDefinition {
    return defineBlock<LinkProps>({
        type,
        label,
        layer: "primitive",
        fields: [
            { name: "label", kind: "text", label: "Label", required: true },
            { name: "href", kind: "url", label: "Link", required: true },
            { name: "variant", kind: "select", label: "Style", options: BUTTON_VARIANTS },
            { name: "size", kind: "select", label: "Size", options: ["sm", "lg"] },
            { name: "newTab", kind: "boolean", label: "Open in a new tab" },
        ],
        component: ({ props, theme }) => {
            const href = props.href.trim();
            const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
            const style = linkStyle(theme, props.variant ?? defaultVariant, props.size ?? "lg");
            const rel = external || props.newTab ? "noopener noreferrer" : undefined;
            const target = props.newTab ? "_blank" : undefined;
            if (external) {
                return (
                    <a href={href} rel={rel} target={target} style={style}>
                        {props.label}
                    </a>
                );
            }
            return (
                <Link href={href} rel={rel} target={target} style={style}>
                    {props.label}
                </Link>
            );
        },
    });
}

/*
 * A list's entries are slots rather than strings, so an entry can hold a bound text block, an icon
 * beside a line, or anything else assembled from primitives.
 */
const list = defineBlock<{ style?: string; gap?: string }, "items">({
    type: "list",
    label: "List",
    layer: "primitive",
    fields: [
        { name: "style", kind: "select", label: "Marker", options: ["bullet", "number", "none"] },
        { name: "gap", label: "Gap", ...spaceSelect },
        { name: "items", kind: "slots", label: "Entries", required: true, min: 1, max: 30 },
    ],
    component: ({ props, slots, theme }) => {
        const ordered = props.style === "number";
        const Tag = ordered ? "ol" : "ul";
        return (
            <Tag
                style={{
                    margin: 0,
                    padding: props.style === "none" ? 0 : undefined,
                    paddingInlineStart: props.style === "none" ? 0 : "1.3em",
                    listStyle: ordered ? "decimal" : props.style === "none" ? "none" : "disc",
                    display: "flex",
                    flexDirection: "column",
                    gap: gap(theme, props.gap, "xs"),
                    color: inherited(theme, "secondaryInk"),
                }}
            >
                {(slots.items ?? []).map((item, i) => (
                    <li key={i}>{item}</li>
                ))}
            </Tag>
        );
    },
});

type DisclosureProps = { label: string; open?: boolean; group?: string; tone?: string };

/*
 * A labelled section that opens. `details` and not a scripted tab strip: a tab strip needs either
 * JavaScript or a stylesheet with sibling selectors, and a primitive can emit neither. What it can
 * emit is the one element the browser already knows how to open and close, which works with the
 * keyboard, is found by the browser's own find-in-page, and needs nothing loaded.
 *
 * Two disclosures sharing a `group` behave as a tab strip does: opening one closes the other.
 */
const disclosure = defineBlock<DisclosureProps, "content">({
    type: "disclosure",
    label: "Disclosure",
    layer: "primitive",
    fields: [
        { name: "label", kind: "text", label: "Label", required: true },
        { name: "open", kind: "boolean", label: "Open to begin with" },
        { name: "group", kind: "text", label: "Only one open in this group" },
        { name: "tone", label: "Tone", ...toneSelect },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: ({ props, slots, theme }) => {
        const tone = toneOf(theme, props.tone);
        return (
            <details
                name={props.group}
                open={props.open === true}
                style={{ borderTop: `1px solid ${tone.hairline}`, padding: `${theme.space.sm} 0` }}
            >
                <summary
                    style={{
                        cursor: "pointer",
                        fontFamily: theme.fonts.heading,
                        fontWeight: 600,
                        fontSize: theme.text.subheading,
                        color: tone.ink,
                    }}
                >
                    {props.label}
                </summary>
                <div style={{ paddingTop: theme.space.sm }}>{slots.content?.[0]}</div>
            </details>
        );
    },
});

/* ---------------------------------------------------------------- motion */

/*
 * The motion blocks of #22. Each one is drawn in its finished state and the animation only takes it
 * away and puts it back, so the page a visitor gets with JavaScript off, or with reduced motion
 * asked for, is the page with the terminal typed out, the figure at its number and the first word of
 * the rotation standing. See motion.ts for why that shape is the whole design.
 */

const reveal = defineBlock<{ style?: string }, "content">({
    type: "reveal",
    label: "Reveal",
    layer: "primitive",
    fields: [
        { name: "style", kind: "select", label: "How", options: ["rise", "fade"] },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: ({ props, slots }) => (
        <>
            <style dangerouslySetInnerHTML={{ __html: revealCss() }} />
            <div data-bp-reveal={props.style === "fade" ? "fade" : "rise"}>{slots.content?.[0]}</div>
        </>
    ),
});

/** The most words one rotation turns through, and the longest a turn may be. */
const MAX_ROTATING = 8;

/*
 * One line where a word is swapped for the next.
 *
 * The words are a comma separated list rather than a slot per word, because this is a tagline and an
 * editor types one. It is also what makes it read a field: a choice field bound with
 * `{{item.Tags}}` arrives here as "a, b, c", which is exactly this shape.
 */
const rotatingText = defineBlock<{ items: string; variant?: string; tone?: string; seconds?: number }>({
    type: "rotatingText",
    label: "Rotating text",
    layer: "primitive",
    fields: [
        { name: "items", kind: "text", label: "Words, separated by commas", required: true },
        { name: "variant", kind: "select", label: "Variant", options: TEXT_VARIANT_NAMES },
        { name: "tone", kind: "select", label: "Ink", options: Object.keys(INK) },
        { name: "seconds", kind: "number", label: "Seconds each", min: 1, max: 20 },
    ],
    component: ({ props, theme }) => {
        const words = props.items
            .split(",")
            .map((w) => w.trim())
            .filter((w) => w !== "")
            .slice(0, MAX_ROTATING);
        if (words.length === 0) return null;
        const variant = TEXT_VARIANTS[props.variant ?? "body"] ?? TEXT_VARIANTS.body;
        const heading = variant.tag !== "p";
        const seconds = props.seconds ?? 3;
        const cls = motionClass("rt", seconds, ...words);
        return (
            <>
                <style dangerouslySetInnerHTML={{ __html: rotatingCss(cls, words.length, seconds) }} />
                <span
                    style={{
                        position: "relative",
                        fontFamily: heading ? theme.fonts.heading : theme.fonts.body,
                        fontSize: theme.text[variant.role],
                        fontWeight: heading ? 600 : 400,
                        lineHeight: heading ? 1.15 : 1.7,
                        color: inherited(theme, INK[props.tone ?? ""] ?? "accent"),
                    }}
                >
                    {/*
                     * The words are stacked and only one is drawn, but opacity hides nothing from a
                     * reader: the stack would be read as every word in a row. So the stack is
                     * presentational and the word that stands at rest is what is read.
                     */}
                    <span className={HIDDEN_CLASS}>{words[0]}</span>
                    <span className={cls} aria-hidden="true">
                        {words.map((word, i) => (
                            <span key={i}>{word}</span>
                        ))}
                    </span>
                </span>
            </>
        );
    },
});

/** The most lines a terminal or a code sample holds. Past this it is a document, not a panel. */
const MAX_LINES = 20;

/*
 * A panel of commands, typed in sequence. The lines are the block's own text, one per line, and the
 * width each one types to is its own length in `ch`, which is a measurement of the text rather than
 * a size this block invented.
 */
const typingTerminal = defineBlock<{ lines: string; prompt?: string; seconds?: number; radius?: string }>({
    type: "typingTerminal",
    label: "Typing terminal",
    layer: "primitive",
    fields: [
        { name: "lines", kind: "text", label: "Lines, one per line", required: true },
        { name: "prompt", kind: "text", label: "Prompt" },
        { name: "seconds", kind: "number", label: "Seconds for the whole loop", min: 2, max: 120 },
        { name: "radius", kind: "select", label: "Corners", options: [...RADII] },
    ],
    component: ({ props, theme }) => {
        const prompt = props.prompt ?? "";
        const lines = linesOf(props.lines, MAX_LINES)
            .map((line) => (prompt ? `${prompt} ${line}` : line))
            .filter((line) => line.trim() !== "");
        if (lines.length === 0) return null;
        const seconds = props.seconds ?? Math.max(4, lines.length * 2);
        const cls = motionClass("tt", seconds, ...lines);
        const tone = toneOf(theme, "inverse");
        return (
            <>
                <style dangerouslySetInnerHTML={{ __html: typingCss(cls, lines.map((l) => l.length), seconds) }} />
                <div
                    className={cls}
                    style={{
                        ...toneVars(tone),
                        boxSizing: "border-box",
                        padding: theme.space.lg,
                        background: tone.bg,
                        color: theme.colors.code,
                        borderRadius: radiusOf(theme, props.radius ?? "panel"),
                        fontFamily: theme.fonts.mono,
                        fontSize: theme.text.small,
                        lineHeight: 1.8,
                        overflowX: "auto",
                    }}
                >
                    {lines.map((line, i) => (
                        <span key={i} style={{ "--bp-w": `${line.length}ch` } as CSSProperties}>
                            {line}
                        </span>
                    ))}
                </div>
            </>
        );
    },
});

/*
 * A snippet somebody is meant to take away.
 *
 * `selectLabel` is the whole of the copy affordance, and it says what it does: one click selects the
 * snippet, and the visitor copies it. A copy button is a control that needs the clipboard API, and
 * this package ships no client component, so a <button> here would be a control that does nothing
 * without JavaScript. That is the same trade `disclosure` made against a tab strip. A site that
 * wants the button registers its own block under this name.
 */
const codeSample = defineBlock<{
    code: string;
    language?: string;
    selectLabel?: string;
    radius?: string;
}>({
    type: "codeSample",
    label: "Code sample",
    layer: "primitive",
    fields: [
        { name: "code", kind: "text", label: "Code", required: true },
        { name: "language", kind: "text", label: "Language" },
        { name: "selectLabel", kind: "text", label: "Say this above it, for copying" },
        { name: "radius", kind: "select", label: "Corners", options: [...RADII] },
    ],
    component: ({ props, theme }) => {
        const lines = linesOf(props.code, MAX_LINES);
        const tone = toneOf(theme, "inverse");
        const meta = { fontFamily: theme.fonts.mono, fontSize: theme.text.meta, color: tone.muted };
        return (
            <div
                style={{
                    ...toneVars(tone),
                    boxSizing: "border-box",
                    padding: theme.space.lg,
                    background: tone.bg,
                    borderRadius: radiusOf(theme, props.radius ?? "panel"),
                }}
            >
                {(props.language || props.selectLabel) && (
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: theme.space.sm,
                            justifyContent: "space-between",
                            marginBottom: theme.space.sm,
                            ...meta,
                        }}
                    >
                        <span>{props.language}</span>
                        <span>{props.selectLabel}</span>
                    </div>
                )}
                <pre
                    style={{
                        margin: 0,
                        // One click takes the whole snippet, which is the copy step a page can offer
                        // with nothing loaded.
                        userSelect: "all",
                        whiteSpace: "pre",
                        overflowX: "auto",
                        fontFamily: theme.fonts.mono,
                        fontSize: theme.text.small,
                        lineHeight: 1.8,
                        color: theme.colors.code,
                    }}
                >
                    {lines.join("\n")}
                </pre>
            </div>
        );
    },
});

/** Every primitive, layout then content. `config` is only read for the embed allow list. */
export function primitiveBlocks(config: PressConfig): BlockDefinition[] {
    return [
        section,
        stack,
        row,
        grid,
        flow,
        panel,
        spacer,
        divider,
        text,
        richText,
        image,
        video,
        embed(config),
        icon,
        anchorBlock("button", "Button", "primary"),
        anchorBlock("link", "Link", "quiet"),
        list,
        disclosure,
        reveal,
        rotatingText,
        typingTerminal,
        codeSample,
    ];
}

export type PrimitiveNode = ReactNode;
