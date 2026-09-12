import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { initials, readingMinutes } from "./reading-time.js";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("readingMinutes", () => {
    it("counts 200 words as a minute", () => {
        expect(readingMinutes(words(200))).toBe(1);
        expect(readingMinutes(words(500))).toBe(3);
    });

    it("never says zero minutes", () => {
        expect(readingMinutes("")).toBe(1);
        expect(readingMinutes("one line")).toBe(1);
    });

    it("does not charge the reader for a fenced code block", () => {
        const body = `${words(150)}\n\n\`\`\`json\n${words(2000)}\n\`\`\`\n\n${words(50)}`;

        // 200 words of prose around a 2000 word sample. Counting the fence would say eleven.
        expect(readingMinutes(body)).toBe(1);
    });

    /*
     * The fence rules, checked against marked because it is the renderer this package uses. A
     * closer is the same character and at least as long as its opener; anything else leaves the
     * block open to the end of the document, and the count has to agree with the page.
     */
    it("closes on a fence longer than the one that opened it", () => {
        const body = `\`\`\`\n${words(2000)}\n\`\`\`\`\n${words(200)}`;

        // The four-backtick line closes the three-backtick block, so only the 200 words count.
        expect(readingMinutes(body)).toBe(1);
    });

    it("stays open on a fence shorter than the one that opened it", () => {
        const body = `\`\`\`\`\n${words(2000)}\n\`\`\`\n${words(2000)}`;

        // marked renders all of this as one code block, so none of it is reading time.
        expect(readingMinutes(body)).toBe(1);
    });

    it("does not let a tilde close a backtick", () => {
        const body = `\`\`\`\n${words(2000)}\n~~~\n${words(2000)}`;

        expect(readingMinutes(body)).toBe(1);
    });

    it("ignores a fence carrying an info string when deciding if it closes", () => {
        const body = `\`\`\`json\n${words(2000)}\n\`\`\` still open\n${words(400)}`;

        // A closing fence carries nothing but the fence, so that line does not close it.
        expect(readingMinutes(body)).toBe(1);
    });

    it("counts prose that follows a properly closed tilde block", () => {
        const body = `~~~\n${words(2000)}\n~~~\n${words(400)}`;

        expect(readingMinutes(body)).toBe(2);
    });

    it("takes a different speed when a site disagrees with 200", () => {
        expect(readingMinutes(words(200), 100)).toBe(2);
    });
});

describe("initials", () => {
    it("takes the first and last name", () => {
        expect(initials("Arnel Robles")).toBe("AR");
        expect(initials("Ada Byron King")).toBe("AK");
    });

    it("takes one letter from a single name", () => {
        // "AR" for "Arnel" would be inventing a surname.
        expect(initials("Arnel")).toBe("A");
    });

    it("survives the spacing an editor actually types", () => {
        expect(initials("  Arnel   Robles  ")).toBe("AR");
        expect(initials("")).toBe("");
    });
});

/*
 * The comment in reading-time.ts says the fence rules were checked against marked. This is that
 * check, so it stays true. marked is the renderer this package ships, so where it puts the code
 * block is where the code block is, and a count that disagrees is counting the wrong words.
 *
 * wordsPerMinute of 1 makes the minutes the word count, which is the number actually under test.
 */
describe("the fence rules agree with the renderer", () => {
    const outsideCodePerMarked = (body: string): number => {
        const html = marked.parse(body, { async: false }) as string;
        const prose = html.replace(/<pre[\s\S]*?<\/pre>/g, " ").replace(/<[^>]+>/g, " ");
        return prose.match(/\S+/g)?.length ?? 0;
    };

    const bodies: Record<string, string> = {
        "closed at the same length": "alpha\n```\ncode here\n```\nbeta gamma",
        "closed by a longer fence": "alpha\n```\ncode here\n````\nbeta gamma",
        "left open by a shorter fence": "alpha\n````\ncode here\n```\nbeta gamma",
        "left open by a much shorter fence": "alpha\n`````\ncode here\n````\nbeta gamma",
        "tilde block": "alpha\n~~~\ncode here\n~~~\nbeta gamma",
        "backtick not closed by a tilde": "alpha\n```\ncode here\n~~~\nbeta gamma",
        "info string on the opener": "alpha\n```json\ncode here\n```\nbeta gamma",
        "no fence at all": "alpha beta gamma delta",
    };

    for (const [name, body] of Object.entries(bodies)) {
        it(name, () => {
            expect(readingMinutes(body, 1)).toBe(Math.max(1, outsideCodePerMarked(body)));
        });
    }
});
