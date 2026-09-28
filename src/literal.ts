/*
 * A value that must reach the page as exactly the characters it holds, even inside markdown.
 *
 * A URL parameter bound into markdown is typed by whoever sent the link. Escaping it for markdown
 * does not work everywhere: a code span, a code block and an autolink show a backslash as written,
 * so an escaped value reads wrong there, and one with a backtick in it can close the span. So the
 * value travels as a token of lowercase letters and digits, which no markdown rule reads as anything
 * but a word, and the renderer swaps the token for the value, HTML-escaped, after markdown is done.
 * A link or an image whose destination holds a token is dropped, so a sent value is never a URL.
 *
 * Anything that is not rendered as markdown gets the value back as it was, through `plainLiterals`.
 * A token someone types by hand decodes to text they chose, escaped, so it can only ever be words.
 */

const PREFIX = "bpqlit";
const END = "x";
const TOKENS = /bpqlit([0-9a-f]*)x/g;
const ANY = /bpqlit[0-9a-f]*x/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function literalToken(value: string): string {
    let hex = "";
    for (const byte of encoder.encode(value)) hex += byte.toString(16).padStart(2, "0");
    return PREFIX + hex + END;
}

export function hasLiteral(text: string): boolean {
    return ANY.test(text);
}

function decode(hex: string): string {
    const bytes = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return decoder.decode(bytes);
}

/** Every token put back as the value it stands for. */
export function plainLiterals(text: string): string {
    return hasLiteral(text) ? text.replace(TOKENS, (_whole, hex: string) => decode(hex)) : text;
}

/** Every token put back as the value it stands for, escaped for HTML text or an attribute. */
export function htmlLiterals(html: string, escape: (value: string) => string): string {
    return hasLiteral(html) ? html.replace(TOKENS, (_whole, hex: string) => escape(decode(hex))) : html;
}
