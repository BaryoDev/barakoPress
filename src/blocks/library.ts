import type { BlockField } from "./schema.js";
import type { BlockPreset } from "./presets.js";
import { FLOW_COLUMNS, TEXT_MOTIONS } from "./primitives.js";
import { HUE_STEPS } from "./motion.js";
import { ALIGNMENTS, RADII, SPACES, TONES, WIDTHS } from "./tokens.js";

/*
 * The block library of barakoPress #21: the named blocks a site is assembled from.
 *
 * Every one of them is a preset, which is to say data. Each holds an arrangement of the primitives
 * and the data blocks, and exposes the props an editor fills in. None of them is code, and that is
 * the point rather than an economy: a code block is a thing a tenant can never adjust, and the
 * blocks here are exactly the ones a designer will want to adjust. A site that wants its hero to
 * put the image first saves its own `hero` in barakoBrew, and it wins over this one.
 *
 * They ship compiled into the registry instead of sitting in each tenant's settings, so a new site
 * has them on the first request with nothing seeded, and a site that never touches them cannot
 * drift from the next release of them.
 *
 * Two rules they keep, which anyone adding one here has to keep too:
 *
 * - No content-shape literal. No type name, no field name, no route. A collection is a prop, and an
 *   entry's fields are read through `{{item.X}}`, which resolves against the names the tenant gave
 *   them. Nothing here knows what rckoronadal.org calls anything (barakoCMS #722, decision D22).
 * - Tokens only. A tone, a spacing step, a type role, a corner, a width. No colour, no pixel value,
 *   and no size of its own anywhere below.
 */

type Block = { type: string; props: Record<string, unknown> };

const b = (type: string, props: Record<string, unknown> = {}): Block => ({ type, props });

/** A block holding one list of blocks. Every layout primitive names that list `content`. */
const holding = (type: string, props: Record<string, unknown>, content: Block[]): Block =>
    b(type, { ...props, content: [content] });

const section = (props: Record<string, unknown>, content: Block[]) => holding("section", props, content);
const stack = (props: Record<string, unknown>, content: Block[]) => holding("stack", props, content);
const flow = (props: Record<string, unknown>, content: Block[]) => holding("flow", props, content);
const panel = (props: Record<string, unknown>, content: Block[]) => holding("panel", props, content);
const source = (props: Record<string, unknown>, content: Block[]) => holding("source", props, content);
const repeat = (props: Record<string, unknown>, content: Block[]) => holding("repeat", props, content);
const showIf = (props: Record<string, unknown>, content: Block[]) => holding("showIf", props, content);
const slot = (name: string) => b("slot", { name });

const t = (value: string, variant?: string, extra: Record<string, unknown> = {}): Block =>
    b("text", { value, ...(variant ? { variant } : {}), ...extra });

/** A prop of the preset itself, with the fallback it takes when nobody set it. */
const p = (name: string, fallback?: string): string =>
    fallback === undefined ? `{{props.${name}}}` : `{{props.${name} ?? ${fallback}}}`;

/* ----------------------------------------------------------------- fields */

const text = (name: string, label: string, required = false): BlockField => ({ name, kind: "text", label, required });
const url = (name: string, label: string, required = false): BlockField => ({ name, kind: "url", label, required });
const choice = (name: string, label: string, options: readonly string[]): BlockField => ({
    name,
    kind: "select",
    label,
    options: [...options],
});
const holds = (name: string, label: string): BlockField => ({ name, kind: "slots", label });

const tone = choice("tone", "Tone", TONES);
const align = choice("align", "Align", ALIGNMENTS);
const padding = choice("padding", "Padding", SPACES);
const width = choice("width", "Width", WIDTHS);
const columns = choice("columns", "Columns", FLOW_COLUMNS);
const heading = text("heading", "Heading");

/* ------------------------------------------------------------ the library */

/*
 * A band at the head of a page: a heading, a line, up to two buttons and an image beside them.
 *
 * `columns` is what makes it one block rather than two: at "1" the text is centred over the full
 * width, at "2" the image sits beside it. The buttons sit behind a `showIf` so that a hero with no
 * call to action has no empty row where one would have been.
 */
const hero: BlockPreset = {
    type: "hero",
    label: "Hero",
    fields: [
        text("heading", "Heading", true),
        text("body", "Body"),
        url("image", "Image"),
        text("imageAlt", "Image alternative text"),
        text("primaryLabel", "Button label"),
        url("primaryHref", "Button link"),
        text("secondaryLabel", "Second button label"),
        url("secondaryHref", "Second button link"),
        tone,
        choice("columns", "Columns", ["1", "2"]),
        align,
        padding,
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xxl"), align: p("align"), width: "wide" }, [
            flow({ columns: p("columns", "1"), gap: "xl", align: "center" }, [
                stack({ gap: "md", align: p("align") }, [
                    t(p("heading"), "display"),
                    t(p("body"), "lead"),
                    showIf({ value: p("primaryHref") }, [
                        flow({ gap: "sm", justify: p("align") }, [
                            b("button", { label: p("primaryLabel", "Read more"), href: p("primaryHref") }),
                            b("button", {
                                label: p("secondaryLabel"),
                                href: p("secondaryHref"),
                                variant: "secondary",
                            }),
                        ]),
                    ]),
                ]),
                b("image", { src: p("image"), alt: p("imageAlt"), radius: "panel", width: "full" }),
            ]),
        ]),
    ],
};

/** A band of copy with one call to action. The End Polio band, the donate band, the contact band. */
const band: BlockPreset = {
    type: "band",
    label: "Band",
    fields: [
        tone,
        heading,
        text("body", "Body"),
        text("label", "Button label"),
        url("href", "Button link"),
        align,
        padding,
        width,
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), align: p("align"), width: p("width") }, [
            t(p("heading"), "title"),
            t(p("body"), "lead"),
            b("button", { label: p("label"), href: p("href") }),
        ]),
    ],
};

/** One figure and what it counts. Several of them go in a `statBand`. */
const stat: BlockPreset = {
    type: "stat",
    label: "Stat",
    fields: [
        text("value", "Figure", true),
        text("label", "Label", true),
        align,
        choice("motion", "Motion", TEXT_MOTIONS),
    ],
    blocks: [
        stack({ gap: "xs", align: p("align", "center") }, [
            t(p("value"), "display", { tone: "accent", align: p("align", "center"), motion: p("motion", "none") }),
            t(p("label"), "meta", { align: p("align", "center") }),
        ]),
    ],
};

const statBand: BlockPreset = {
    type: "statBand",
    label: "Stat band",
    fields: [heading, tone, columns, padding, holds("items", "Stats")],
    blocks: [
        section({ tone: p("tone", "accent"), padding: p("padding", "xl"), width: "wide", align: "center" }, [
            t(p("heading"), "title"),
            flow({ columns: p("columns", "4"), gap: "lg" }, [slot("items")]),
        ]),
    ],
};

/** A date beside what happened. Several of them go in a `timeline`. */
const timelineEntry: BlockPreset = {
    type: "timelineEntry",
    label: "Timeline entry",
    fields: [text("date", "Date", true), text("title", "Title", true), text("body", "Body")],
    blocks: [
        flow({ columns: "auto", gap: "md", align: "start" }, [
            t(p("date"), "meta", { tone: "accent" }),
            stack({ gap: "xs" }, [t(p("title"), "heading"), t(p("body"))]),
        ]),
    ],
};

const timeline: BlockPreset = {
    type: "timeline",
    label: "Timeline",
    fields: [heading, tone, padding, width, holds("items", "Entries")],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            slot("items"),
        ]),
    ],
};

/** A numbered step. Several of them go in `steps`. */
const step: BlockPreset = {
    type: "step",
    label: "Step",
    fields: [text("number", "Number", true), text("title", "Title", true), text("body", "Body")],
    blocks: [
        flow({ columns: "auto", gap: "md", align: "start" }, [
            t(p("number"), "title", { tone: "accent" }),
            stack({ gap: "xs" }, [t(p("title"), "heading"), t(p("body"))]),
        ]),
    ],
};

const steps: BlockPreset = {
    type: "steps",
    label: "Steps",
    fields: [heading, tone, padding, width, holds("items", "Steps")],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            slot("items"),
        ]),
    ],
};

/** One line of a `keyValueTable`: what it is on the left, what it says on the right. */
const keyValueRow: BlockPreset = {
    type: "keyValueRow",
    label: "Row",
    fields: [text("label", "Label", true), text("value", "Value", true)],
    blocks: [
        flow({ columns: "2", gap: "sm", align: "start" }, [t(p("label"), "meta"), t(p("value"))]),
    ],
};

const keyValueTable: BlockPreset = {
    type: "keyValueTable",
    label: "Facts",
    fields: [heading, tone, padding, choice("radius", "Corners", RADII), holds("rows", "Rows")],
    blocks: [
        panel({ tone: p("tone", "surface"), padding: p("padding", "lg"), radius: p("radius", "panel") }, [
            t(p("heading"), "heading"),
            slot("rows"),
        ]),
    ],
};

/** One giving tier. Several of them go in `tiers`. */
const tier: BlockPreset = {
    type: "tier",
    label: "Tier",
    fields: [
        text("name", "Name", true),
        text("amount", "Amount"),
        text("body", "Body"),
        text("label", "Button label"),
        url("href", "Button link"),
        tone,
    ],
    blocks: [
        panel({ tone: p("tone", "surface"), padding: "lg" }, [
            t(p("name"), "heading"),
            t(p("amount"), "title", { tone: "accent" }),
            t(p("body")),
            b("button", { label: p("label"), href: p("href"), variant: "secondary", size: "sm" }),
        ]),
    ],
};

const tiers: BlockPreset = {
    type: "tiers",
    label: "Tiers",
    fields: [heading, tone, columns, padding, holds("items", "Tiers")],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: "wide" }, [
            t(p("heading"), "title"),
            flow({ columns: p("columns", "3"), gap: "lg" }, [slot("items")]),
        ]),
    ],
};

/** One person. Several go in a `peopleGrid`, or it reads them from a collection instead. */
const person: BlockPreset = {
    type: "person",
    label: "Person",
    fields: [
        text("name", "Name", true),
        text("role", "Role"),
        url("photo", "Photo"),
        url("href", "Link"),
        text("linkLabel", "Link label"),
        align,
    ],
    blocks: [
        stack({ gap: "xs", align: p("align", "center") }, [
            b("image", { src: p("photo"), alt: p("name"), radius: "pill", frame: false }),
            t(p("name"), "heading", { align: p("align", "center") }),
            t(p("role"), "meta", { align: p("align", "center") }),
            b("link", { label: p("linkLabel", "Profile"), href: p("href") }),
        ]),
    ],
};

/*
 * A grid of people, from a collection or from entries typed in place, or both.
 *
 * Both, because the two are the same band on different pages: a board read from the CMS, and a list
 * of past presidents nobody wants a content type for. An unset `collection` reads nothing rather
 * than everything, which is what `source` does with a name it cannot find.
 */
const peopleGrid: BlockPreset = {
    type: "peopleGrid",
    label: "People",
    fields: [
        heading,
        text("collection", "Collection"),
        text("filterField", "Only entries whose field"),
        text("filterValue", "Holds the value"),
        text("role", "Field holding the role"),
        tone,
        columns,
        padding,
        holds("items", "People typed in place"),
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: "wide" }, [
            t(p("heading"), "title"),
            flow({ columns: p("columns", "4"), gap: "lg" }, [
                source(
                    {
                        collection: p("collection"),
                        mode: "list",
                        filterField: p("filterField"),
                        filterValue: p("filterValue"),
                    },
                    [
                        repeat({}, [
                            stack({ gap: "xs", align: "center" }, [
                                b("image", { src: "{{item.Image}}", alt: "{{item.Title}}", radius: "pill", frame: false }),
                                t("{{item.Title}}", "heading", { align: "center" }),
                                t("{{item.Summary}}", "meta", { align: "center" }),
                            ]),
                        ]),
                    ],
                ),
                slot("items"),
            ]),
        ]),
    ],
};

/*
 * A grid of cards from a collection: the signature projects, every project, the news rail. Or,
 * with no `collection` set, from `card`s typed in place, the same choice `peopleGrid` already
 * gives: a live grid and a hand-kept one are the same band on different pages.
 *
 * The card's title is a link, so a collection with no route of its own renders cards with no title.
 * That is the right way round: a card grid is a way into the detail pages, and a collection without
 * them is a collection this block cannot do anything useful with.
 */
const cardGrid: BlockPreset = {
    type: "cardGrid",
    label: "Card grid",
    fields: [
        heading,
        text("collection", "Collection"),
        text("filterField", "Only entries whose field"),
        text("filterValue", "Holds the value"),
        text("empty", "Say this when there is nothing"),
        tone,
        columns,
        padding,
        choice("hueRotate", "Rotate card hues", HUE_STEPS),
        choice("option", "Show each entry's option", ["none", "show"]),
        holds("items", "Cards typed in place"),
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: "wide" }, [
            t(p("heading"), "title"),
            flow({ columns: p("columns", "3"), gap: "lg", hueRotate: p("hueRotate", "none") }, [
                source(
                    {
                        collection: p("collection"),
                        mode: "list",
                        filterField: p("filterField"),
                        filterValue: p("filterValue"),
                    },
                    [
                        repeat({ empty: p("empty") }, [
                            panel({ padding: "lg" }, [
                                stack({ gap: "xs" }, [
                                    showIf({ value: "{{item.Image}}" }, [
                                        b("image", {
                                            src: "{{item.Image}}",
                                            alt: "{{item.ImageAlt}}",
                                            radius: "panel",
                                            width: "full",
                                        }),
                                    ]),
                                    /*
                                     * The glyph and the word the site declared for this entry's
                                     * option (#52), which is what turns a card grid into the module
                                     * grid barakocms.com wants: `filterField` picks the category and
                                     * this marks each card with it. Both read the option's style, so
                                     * no block here names an icon or a category. An entry with no
                                     * option, or a site that declared no style for it, drops them
                                     * rather than drawing an empty row. `tint` is the option's own
                                     * colour (barakoPress #91): a card whose entry carries a brand of
                                     * its own draws that brand's badge instead of the theme's accent.
                                     */
                                    showIf({ value: p("option", "none"), equals: "show" }, [
                                        flow({ columns: "auto", gap: "xs", align: "center" }, [
                                            b("icon", { name: "{{item.Icon}}", size: "sm", tint: "{{item.Color}}" }),
                                            t("{{item.Word}}", "meta", { tone: "accent" }),
                                        ]),
                                    ]),
                                    t("{{item.Date | date}}", "meta"),
                                    b("link", { label: "{{item.Title}}", href: "{{item.Href}}" }),
                                    t("{{item.Summary}}"),
                                ]),
                            ]),
                        ]),
                    ],
                ),
                slot("items"),
            ]),
        ]),
    ],
};

/**
 * One card of a `cardGrid` with no `collection`: the package family grid, the tool list, anything a
 * page author keeps by hand rather than in a collection. `tint` is a colour written out rather than
 * a `tone`, because the whole point is a card whose colour is its own rather than the theme's.
 */
const card: BlockPreset = {
    type: "card",
    label: "Card",
    fields: [
        text("title", "Title", true),
        text("tag", "Short tag"),
        text("body", "Body"),
        text("meta", "Footer line"),
        text("icon", "Icon"),
        text("tint", "Colour from the entry, over the tone"),
        text("linkLabel", "Link label"),
        url("href", "Link"),
        url("image", "Image"),
        text("imageAlt", "Image alternative text"),
    ],
    blocks: [
        panel({ padding: "lg" }, [
            stack({ gap: "sm" }, [
                showIf({ value: p("image") }, [
                    b("image", { src: p("image"), alt: p("imageAlt"), radius: "panel", width: "full" }),
                ]),
                flow({ columns: "auto", gap: "xs", align: "center" }, [
                    b("icon", { name: p("icon"), size: "sm", tint: p("tint") }),
                    t(p("title"), "heading"),
                    showIf({ value: p("tag") }, [t(p("tag"), "meta", { tone: "muted" })]),
                ]),
                showIf({ value: p("body") }, [t(p("body"))]),
                showIf({ value: p("meta") }, [t(p("meta"), "meta")]),
                showIf({ value: p("href") }, [b("link", { label: p("linkLabel", "Learn more"), href: p("href") })]),
            ]),
        ]),
    ],
};

/*
 * A map, which is an `embed` with a heading. The URL is held to the site's `embedHosts` by the embed
 * primitive, so the allow list the issue asks for is the one the site already keeps, and a map
 * provider a site does not trust never reaches the page.
 */
const map: BlockPreset = {
    type: "map",
    label: "Map",
    fields: [
        url("src", "Map URL", true),
        text("title", "What it is", true),
        heading,
        choice("aspect", "Shape", ["16:9", "4:3", "1:1"]),
        tone,
        padding,
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "lg"), width: "wide" }, [
            t(p("heading"), "title"),
            b("embed", { src: p("src"), title: p("title"), aspect: p("aspect", "16:9"), radius: "panel" }),
        ]),
    ],
};

/*
 * A snippet somebody is meant to run, with the other ways of running it beside it as a real tab
 * strip (barakoPress #91).
 *
 * The first sample stays open to begin with, because a quickstart is for the line you type and
 * hiding it behind a click is hiding the point of the page; it is a `tabPanel` and not a plain
 * `codeSample` now only so it sits in the same strip as the rest, and it renders exactly as before
 * for a reader with no script. `codeTab`s used `disclosure` for the reason `tabs` still does: the
 * package had no client component and a strip needs either one or a stylesheet, and it had neither.
 * It now has `tabGroup` and `tabPanel`, which are the stylesheet (see primitives.tsx), so this is
 * the one place that constraint changed. `tabs` stays `disclosure`: it holds whatever a page drops
 * into it, and a strip is the wrong shape for content nobody has measured against a design.
 */
const codeTabs: BlockPreset = {
    type: "codeTabs",
    label: "Code tabs",
    fields: [
        heading,
        text("body", "Body"),
        text("code", "Code", true),
        text("language", "Language"),
        text("selectLabel", "Say this above it, for copying"),
        text("primaryLabel", "Tab label for the code above"),
        tone,
        padding,
        width,
        holds("items", "The other ways"),
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            t(p("body"), "lead"),
            holding("tabGroup", { gap: "xs" }, [
                holding("tabPanel", { label: p("primaryLabel", "Run it"), open: true, group: "codeTabs" }, [
                    b("codeSample", { code: p("code"), language: p("language"), selectLabel: p("selectLabel") }),
                ]),
                slot("items"),
            ]),
        ]),
    ],
};

/** One more way to run it. Several with the same `group` open one at a time. */
const codeTab: BlockPreset = {
    type: "codeTab",
    label: "Code tab",
    fields: [
        text("label", "Label", true),
        text("code", "Code", true),
        text("language", "Language"),
        text("selectLabel", "Say this above it, for copying"),
        text("group", "Only one open in this group"),
    ],
    blocks: [
        holding("tabPanel", { label: p("label"), group: p("group", "codeTabs") }, [
            b("codeSample", { code: p("code"), language: p("language"), selectLabel: p("selectLabel") }),
        ]),
    ],
};

/*
 * How far along each of a list of things is: the roadmap, the milestones, the targets.
 *
 * The figure comes from the collection's `progress` field role, so the block reads `{{item.Progress}}`
 * and the tenant says which of its own fields that is. The bar carries the entry's title as its
 * label rather than repeating it in a heading above, because a progress bar has to be named for
 * anything to read it, and naming it twice reads it twice.
 */
const progressList: BlockPreset = {
    type: "progressList",
    label: "Progress list",
    fields: [
        heading,
        text("collection", "Collection", true),
        text("filterField", "Only entries whose field"),
        text("filterValue", "Holds the value"),
        text("empty", "Say this when there is nothing"),
        tone,
        padding,
        width,
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            source(
                {
                    collection: p("collection"),
                    mode: "list",
                    filterField: p("filterField"),
                    filterValue: p("filterValue"),
                },
                [
                    repeat({ empty: p("empty") }, [
                        stack({ gap: "xs" }, [
                            b("progressBar", { label: "{{item.Title}}", value: "{{item.Progress}}" }),
                            t("{{item.Summary}}", "small"),
                        ]),
                    ]),
                ],
            ),
        ]),
    ],
};

/*
 * Release entries, newest first, each with its version, the kind of release it was and what changed.
 *
 * Grouped by kind is `filterField` and `filterValue`, one band per kind with its own heading, rather
 * than a grouping this block does: a block that grouped would have to know which field holds the
 * kind, and that is the tenant's field name. The chip on each entry is the option's own word (#52),
 * so an entry with no option shows none.
 */
const changelogList: BlockPreset = {
    type: "changelogList",
    label: "Changelog",
    fields: [
        heading,
        text("collection", "Collection", true),
        text("filterField", "Only entries whose field"),
        text("filterValue", "Holds the value"),
        text("empty", "Say this when there is nothing"),
        tone,
        padding,
        width,
    ],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            source(
                {
                    collection: p("collection"),
                    mode: "list",
                    filterField: p("filterField"),
                    filterValue: p("filterValue"),
                },
                [
                    repeat({ empty: p("empty") }, [
                        stack({ gap: "xs" }, [
                            flow({ columns: "auto", gap: "sm", align: "center" }, [
                                t("{{item.Title}}", "heading"),
                                t("{{item.Word}}", "meta", { tone: "accent" }),
                                t("{{item.Date | date}}", "meta"),
                            ]),
                            b("richText", { markdown: "{{item.Body}}", width: "full" }),
                        ]),
                    ]),
                ],
            ),
        ]),
    ],
};

/*
 * Questions that open, and what it does not do.
 *
 * No group, which is the whole difference from `tabs`: a reader comparing two answers wants both
 * open, and a tab strip takes the first one away when they open the second.
 */
const faq: BlockPreset = {
    type: "faq",
    label: "Questions",
    fields: [heading, text("body", "Body"), tone, padding, width, holds("items", "Questions")],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            t(p("body"), "lead"),
            slot("items"),
        ]),
    ],
};

const faqItem: BlockPreset = {
    type: "faqItem",
    label: "Question",
    fields: [text("question", "Question", true), text("answer", "Answer", true), tone],
    blocks: [
        holding("disclosure", { label: p("question"), tone: p("tone") }, [
            b("richText", { markdown: p("answer"), width: "full" }),
        ]),
    ],
};

/** The one line a site puts above everything, and it stays there while the page moves under it. */
const announcement: BlockPreset = {
    type: "announcement",
    label: "Announcement bar",
    fields: [
        text("message", "Message", true),
        text("label", "Link label"),
        url("href", "Link"),
        tone,
        choice("edge", "Sticks to", ["top", "bottom"]),
        align,
    ],
    blocks: [
        holding(
            "stickyBar",
            { tone: p("tone", "inverse"), edge: p("edge", "top"), padding: "sm", align: p("align", "center") },
            [
                flow({ columns: "auto", gap: "sm", align: "center", justify: p("align", "center") }, [
                    t(p("message"), "small"),
                    b("link", { label: p("label"), href: p("href") }),
                ]),
            ],
        ),
    ],
};

/*
 * Sections that open one at a time, each holding whatever blocks were dropped into it.
 *
 * The issue calls this tabs. It is a column of `disclosure` blocks rather than a tab strip, because
 * a tab strip is JavaScript or a stylesheet with sibling selectors and a block can ship neither.
 * Giving each disclosure the same `group` gets the behaviour that matters: one open at a time.
 */
const tabs: BlockPreset = {
    type: "tabs",
    label: "Tabs",
    fields: [heading, tone, padding, width, holds("items", "Sections")],
    blocks: [
        section({ tone: p("tone"), padding: p("padding", "xl"), width: p("width", "prose") }, [
            t(p("heading"), "title"),
            slot("items"),
        ]),
    ],
};

/**
 * Every block in the library, in the order an editor should meet them: the bands first, then the
 * parts that go inside one.
 */
export function libraryPresets(): BlockPreset[] {
    return [
        announcement,
        hero,
        band,
        statBand,
        cardGrid,
        peopleGrid,
        timeline,
        steps,
        tiers,
        keyValueTable,
        codeTabs,
        progressList,
        changelogList,
        faq,
        tabs,
        map,
        stat,
        timelineEntry,
        step,
        tier,
        person,
        keyValueRow,
        codeTab,
        faqItem,
        card,
    ];
}
