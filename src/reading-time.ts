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

/*
 * Fenced blocks come out before counting. A post with a forty-line config sample is not four
 * minutes longer to read than the same post without it, and counting the fence would say it was.
 * The fence is matched loosely because the body is whatever an editor wrote, not a parsed tree.
 */
const FENCED_BLOCK = /^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm;

/** Whole minutes, never zero. A one-line post reads as "1 min read", not "0 min read". */
export function readingMinutes(body: string, wordsPerMinute = WORDS_PER_MINUTE): number {
    const prose = body.replace(FENCED_BLOCK, " ");
    const words = prose.match(/\S+/g)?.length ?? 0;
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
