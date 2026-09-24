import { Marked, type Tokens } from "marked";
import { LINK_REL, NEW_TAB_TARGET } from "./config.js";

/*
 * Markdown to HTML, treating the markdown as untrusted.
 *
 * An editor is authenticated, so this is not the first line of defence. It is the second, and it
 * matters because the body of a post is the one field on this site that becomes markup. The
 * threats it closes: an editor account that gets taken over, a contributor who is trusted to write
 * but not to run script on the domain, and content imported in bulk from somewhere else.
 *
 * Three rules:
 *   1. Raw HTML in the source is escaped, never passed through. That removes script tags, event
 *      handler attributes and iframes in one move, instead of trying to enumerate them.
 *   2. A link or image destination must be http, https or mailto. That kills javascript: and
 *      data: URLs, which are the two that execute.
 *   3. Text is escaped on the way into every attribute, so an alt or a title cannot close its own
 *      quote and add another attribute.
 *
 * The trade is real and deliberate: an author cannot embed a YouTube iframe or any raw HTML. When
 * that is wanted, the answer is a content field the frontend renders deliberately, not a hole here.
 *
 * This file is also the `barakopress/markdown` entry, which an editor loads in the browser to
 * preview a post with the same rules. So it imports `marked` and `./config.js` only, and nothing it
 * reaches may import next/* or node:*. The entry test checks that on the built file.
 */

const SAFE_SCHEMES = ["http:", "https:", "mailto:"];

export function isSafeHref(href: string): boolean {
    const trimmed = href.trim();
    // `//host` and `/\host` are read by a browser as another site, not a path on this one.
    if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return false;
    // A relative or anchor link has no scheme and cannot execute.
    if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
    try {
        return SAFE_SCHEMES.includes(new URL(trimmed).protocol);
    } catch {
        // Unparseable means it is not a URL this should emit.
        return false;
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** Turns a heading into a stable id, so "On this page" links and deep links work. */
export function anchor(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

export interface RenderMarkdownOptions {
    /** Give each heading an id from its text. Default true. */
    headingIds?: boolean;
    /** Open every link in a new tab, with rel="noopener noreferrer". Default false. */
    newTab?: boolean;
}

function buildRenderer(headingIds: boolean, newTab: boolean) {
    const marked = new Marked({ gfm: true, breaks: false });

    marked.use({
        renderer: {
            // Raw HTML blocks and inline HTML are emitted as visible text, not as markup.
            html({ text }: Tokens.HTML | Tokens.Tag) {
                return escapeHtml(text);
            },
            link({ href, title, tokens }) {
                const label = this.parser.parseInline(tokens);
                if (!isSafeHref(href)) {
                    // Keep the words, drop the destination. A reader still sees what was written.
                    return label;
                }
                const t = title ? ` title="${escapeHtml(title)}"` : "";
                const external = /^https?:/.test(href.trim());
                const rel = external || newTab ? ` rel="${LINK_REL}"` : "";
                const target = newTab ? ` target="${NEW_TAB_TARGET}"` : "";
                return `<a href="${escapeHtml(href.trim())}"${t}${target}${rel}>${label}</a>`;
            },
            image({ href, title, text }) {
                if (!isSafeHref(href)) return escapeHtml(text ?? "");
                const t = title ? ` title="${escapeHtml(title)}"` : "";
                return `<img src="${escapeHtml(href.trim())}" alt="${escapeHtml(text ?? "")}"${t} loading="lazy">`;
            },
            heading({ tokens, depth }) {
                const label = this.parser.parseInline(tokens);
                if (!headingIds) return `<h${depth}>${label}</h${depth}>`;
                const plain = tokens.map((t) => ("raw" in t ? t.raw : "")).join("");
                return `<h${depth} id="${escapeHtml(anchor(plain))}">${label}</h${depth}>`;
            },
        },
    });

    return marked;
}

// One renderer per combination of options, built on first use. There are four.
const renderers = new Map<string, ReturnType<typeof buildRenderer>>();

export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
    if (!source) return "";
    const headingIds = options.headingIds ?? true;
    const newTab = options.newTab ?? false;
    const key = `${headingIds}:${newTab}`;
    let renderer = renderers.get(key);
    if (!renderer) {
        renderer = buildRenderer(headingIds, newTab);
        renderers.set(key, renderer);
    }
    return renderer.parse(source, { async: false }) as string;
}

export interface MarkdownHeading {
    /** The id `renderMarkdown` gives the heading, so `#id` lands on it. */
    id: string;
    /** The heading as plain text, with its inline markup dropped. */
    text: string;
}

type InlineToken = { type: string; raw?: string; text?: string; tokens?: InlineToken[] };

/*
 * The named references a heading is likely to be written with, by code point. Written as numbers so
 * the characters themselves stay out of the source. Anything not here, named, is left as written.
 */
const NAMED: Readonly<Record<string, number>> = {
    amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160, copy: 169, reg: 174, trade: 8482,
    mdash: 8212, ndash: 8211, hellip: 8230, middot: 183, bull: 8226, times: 215, divide: 247,
    lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, laquo: 171, raquo: 187, deg: 176, plusmn: 177,
    euro: 8364, pound: 163, yen: 165, cent: 162, sect: 167, para: 182, larr: 8592, rarr: 8594,
};

/** Character references read as the characters a browser would draw for them. */
export function decodeEntities(text: string): string {
    return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, ref: string) => {
        let code: number | undefined;
        if (ref[0] === "#") code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        else code = Object.hasOwn(NAMED, ref.toLowerCase()) ? NAMED[ref.toLowerCase()] : undefined;
        if (code === undefined || !Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
        return String.fromCodePoint(code);
    });
}

function plainText(tokens: InlineToken[]): string {
    return tokens
        .map((t) => {
            if (t.type === "html") return t.raw ?? "";
            if (t.tokens && t.tokens.length > 0) return plainText(t.tokens);
            return decodeEntities(t.text ?? t.raw ?? "");
        })
        .join("");
}

let lexer: Marked | undefined;

/**
 * The headings of one level in a markdown source, in order, with the ids `renderMarkdown` gives them.
 *
 * Read from the lexer rather than from rendered HTML, so listing a page's headings costs a tokenise
 * and not a render. The id is worked out the way the renderer works it out, from the heading's raw
 * inline source, and that is what keeps a link to `#id` landing on the heading it names.
 */
export function markdownHeadings(source: string, depth = 2): MarkdownHeading[] {
    if (!source) return [];
    lexer ??= new Marked({ gfm: true, breaks: false });
    const out: MarkdownHeading[] = [];
    for (const token of lexer.lexer(source)) {
        if (token.type !== "heading" || token.depth !== depth) continue;
        const inline = (token.tokens ?? []) as InlineToken[];
        const id = anchor(inline.map((t) => t.raw ?? "").join(""));
        const text = plainText(inline).trim();
        if (id && text) out.push({ id, text });
    }
    return out;
}

/*
 * One line of text with a few marks in it, for a text block's inline mode (#131): `code`, *emphasis*,
 * **strong**, [links](/x) and ==an accent==, which draws as `<span class="bp-accent">`. Nothing
 * that makes a block of its own: a heading, a list or a paragraph is written as the text it is, so
 * a lede stays one element and a heading stays a heading.
 *
 * The same rules as the body, on a renderer of its own: raw HTML escaped, a link held to the same
 * schemes, every attribute escaped. An image, a strikethrough and a hard break keep their words and
 * lose the mark, since none of them is something a line of copy is asked to carry.
 */
function buildInlineRenderer() {
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({
        extensions: [
            {
                name: "accent",
                level: "inline",
                start(src: string) {
                    const at = src.indexOf("==");
                    return at < 0 ? undefined : at;
                },
                tokenizer(src: string) {
                    // Accents do not nest: `==` inside one ends it or is not an accent at all.
                    const match = /^==(?=\S)((?:(?!==)[\s\S])*?\S)==/.exec(src);
                    if (!match) return undefined;
                    return { type: "accent", raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
                },
                renderer(token) {
                    return `<span class="bp-accent">${this.parser.parseInline(token.tokens ?? [])}</span>`;
                },
            },
        ],
        renderer: {
            html({ text }: Tokens.HTML | Tokens.Tag) {
                return escapeHtml(text);
            },
            link({ href, title, tokens }) {
                const label = this.parser.parseInline(tokens);
                if (!isSafeHref(href)) return label;
                const t = title ? ` title="${escapeHtml(title)}"` : "";
                const rel = /^https?:/.test(href.trim()) ? ` rel="${LINK_REL}"` : "";
                return `<a href="${escapeHtml(href.trim())}"${t}${rel}>${label}</a>`;
            },
            image({ text }) {
                return escapeHtml(text ?? "");
            },
            del({ tokens }) {
                return this.parser.parseInline(tokens);
            },
            br() {
                return " ";
            },
        },
    });
    return marked;
}

let inlineRenderer: ReturnType<typeof buildInlineRenderer> | undefined;

/*
 * The longest value read for marks. Emphasis parsing is quadratic in the worst case (`*a ` repeated
 * sixty thousand times takes a minute), and a text block's value can be bound from content nobody
 * editing the page wrote. A line of copy is well under this; past it the value is plain text.
 */
export const MAX_INLINE = 2000;

/** A line of text with inline marks, as HTML. Block syntax is left as the text it is. */
export function renderInlineMarkdown(source: string): string {
    if (!source) return "";
    if (source.length > MAX_INLINE) return escapeHtml(source);
    inlineRenderer ??= buildInlineRenderer();
    return inlineRenderer.parseInline(source, { async: false }) as string;
}
