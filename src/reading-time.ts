/*
 * Read time, derived rather than typed.
 *
 * The design handoff carries "7 min read" and marks it invented, which is the right thing to do in
 * a mock and the wrong thing to ship: a number an editor has to remember to update is a number
 * that is wrong by the second edit. This computes it from the body, so there is no field to fill
 * in and nothing to keep in sync.
 *
 * 200 words a minute is the low end of adult reading speed for unfamiliar prose. It is a
 * convention rather than a measurement, and it is here as a named constant so a site that
 * disagrees can see what it is disagreeing with.
 */
const WORDS_PER_MINUTE = 200;

/** A line that opens or could close a fence: three or more backticks or tildes, indented or not. */
const FENCE = /^[ \t]*(`{3,}|~{3,})([^\n]*)$/;

/*
 * Fenced blocks come out before counting. A post with a forty-line config sample is not four
 * minutes longer to read than the same post without it, and counting the fence would say it was.
 *
 * A line scanner rather than one regular expression, because the rule a closing fence follows
 * cannot be written as a backreference. Checked against marked, which is the renderer this package
 * actually uses, and it follows CommonMark:
 *
 *   open ```   close ````   closed, because a closer may be longer than its opener
 *   open ````  close ```    not closed, and the rest of the document is inside the block
 *   open ````` close ````   not closed, same reason
 *
 * So a closer is the same character, at least as long, and carries nothing else on its line. An
 * unterminated fence runs to the end, which is also what the renderer does, so the count and the
 * page agree about where the code is.
 */
function withoutFencedBlocks(body: string): string {
    const kept: string[] = [];
    let open: { char: string; length: number } | null = null;

    for (const line of body.split("\n")) {
        const match = FENCE.exec(line);

        if (!open) {
            if (match) {
                open = { char: match[1][0], length: match[1].length };
                continue;
            }
            kept.push(line);
            continue;
        }

        const closes =
            match !== null &&
            match[1][0] === open.char &&
            match[1].length >= open.length &&
            match[2].trim() === "";
        if (closes) open = null;
    }

    return kept.join("\n");
}

/** Whole minutes, never zero. A one-line post reads as "1 min read", not "0 min read". */
export function readingMinutes(body: string, wordsPerMinute = WORDS_PER_MINUTE): number {
    const words = withoutFencedBlocks(body).match(/\S+/g)?.length ?? 0;
    return Math.max(1, Math.round(words / wordsPerMinute));
}

/**
 * Initials for the byline chip, at most two.
 *
 * A single name gives one letter rather than two from the same word, because "AR" for "Arnel"
 * would be inventing a surname.
 */
export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    const letters = parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]];
    return letters.map((p) => [...p][0]?.toUpperCase() ?? "").join("");
}
