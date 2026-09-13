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
