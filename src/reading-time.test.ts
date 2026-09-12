import { describe, expect, it } from "vitest";
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
