import { describe, expect, it } from "vitest";
import { pickRelated } from "./related.js";
import type { SemanticHit } from "./delivery.js";

const hit = (slug: string | undefined, score: number): SemanticHit => ({
    contentType: "post",
    slug,
    title: slug ? `About ${slug}` : "Untitled",
    score,
});

describe("pickRelated", () => {
    it("drops the post being read", () => {
        // The post is its own closest match and comes back first almost every time, which is why
        // the fetch asks for more than it renders.
        const picked = pickRelated([hit("here", 0.99), hit("a", 0.88), hit("b", 0.81)], "here", 3);

        expect(picked).toHaveLength(2);
        expect(picked.map((p) => p.slug)).toEqual(["a", "b"]);
    });

    it("drops a hit with no slug, because there is nothing to link it to", () => {
        const picked = pickRelated([hit(undefined, 0.9), hit("a", 0.88)], "here", 3);

        expect(picked).toHaveLength(1);
        expect(picked[0].slug).toBe("a");
    });

    it("renders no more than the limit", () => {
        const picked = pickRelated([hit("a", 0.9), hit("b", 0.8), hit("c", 0.7), hit("d", 0.6)], "here", 3);

        expect(picked).toHaveLength(3);
        expect(picked.map((p) => p.slug)).toEqual(["a", "b", "c"]);
    });

    it("keeps the order the API ranked them in", () => {
        // The API sorts by score descending. Re-sorting here would be a second opinion on a
        // ranking this package did not compute.
        const picked = pickRelated([hit("a", 0.91), hit("b", 0.9), hit("c", 0.89)], "here", 3);

        expect(picked.map((p) => p.score)).toEqual([0.91, 0.9, 0.89]);
    });

    it("gives back nothing when the module answered with nothing", () => {
        expect(pickRelated([], "here", 3)).toEqual([]);
    });
});
