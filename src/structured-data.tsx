import type { PressConfig } from "./config.js";
import type { PublicContent } from "./delivery.js";

/*
 * The schema.org block barakoCMS 4.8 sends with a read by slug (barakoCMS #567), drawn as
 * `<script type="application/ld+json">`.
 *
 * The API builds it from the type's field roles, so this does not read or reshape it: an object goes
 * out as the API sent it, anything else is not drawn. What is this side's job is the element. A
 * script element's text ends at the first `</script`, whatever JSON says about quotes, so every `<`
 * is written as <, which JSON reads back as the same character and HTML never reads as a tag.
 * U+2028 and U+2029 are escaped too, since older JavaScript parsers end a line on them.
 *
 * Bounded, because it lands in every copy of the page: a block over the limit is left out and said
 * once, rather than shipped or cut into JSON nobody can parse.
 */
const MAX_STRUCTURED_DATA_CHARS = 64 * 1024;

const said = new Set<string>();

/** The block as text that is safe inside a script element, or null when there is nothing to draw. */
export function structuredDataJson(value: unknown): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    let json: string;
    try {
        json = JSON.stringify(value);
    } catch {
        return null;
    }
    if (json === "{}") return null;
    if (json.length > MAX_STRUCTURED_DATA_CHARS) {
        const message = `structured data: a block of ${json.length} characters is over the ${MAX_STRUCTURED_DATA_CHARS} drawn, left out`;
        if (!said.has(message)) {
            if (said.size >= 200) said.clear();
            said.add(message);
            console.warn(message);
        }
        return null;
    }
    return json.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * The entry's JSON-LD, when the API sent one and the site has not turned it off with
 * `structuredData: false`. Next gives a page no way into the document head but its metadata, which
 * has no JSON-LD field, so this is drawn at the top of the page, where search engines read it too.
 */
export function StructuredData({ config, content }: { config: PressConfig; content: PublicContent | undefined }) {
    if (config.structuredData === false || !content) return null;
    const json = structuredDataJson(content.structuredData);
    return json === null ? null : <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
