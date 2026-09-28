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
 *
 * The prefix is random per process, so text in stored content cannot be read as a token. That holds
 * because a token lives only between binding and rendering, inside one request: bound props are
 * never stored or handed to another process, and what is cached is the HTML after decoding.
 */

function randomPrefix(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return "bp" + Array.from(bytes, (b) => String.fromCharCode(103 + (b % 20))).join("");
}

// Letters from g to z only, so the prefix can never be read as part of the hex after it.
const PREFIX = randomPrefix();
const END = "z";
const TOKENS = new RegExp(`${PREFIX}([0-9a-f]*)${END}`, "g");
const ANY = new RegExp(`${PREFIX}[0-9a-f]*${END}`);

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
