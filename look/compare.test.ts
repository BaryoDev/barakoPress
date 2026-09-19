import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { asPercent, comparePngs } from "./compare.js";

type Rgb = [number, number, number];

const NAVY: Rgb = [23, 38, 79];
const RUST: Rgb = [178, 58, 31];
const WHITE: Rgb = [255, 255, 255];

/** A plain image, optionally with one solid block painted into it. */
function image(
    width: number,
    height: number,
    block?: { x: number; y: number; width: number; height: number; colour: Rgb },
): Buffer {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const inBlock =
                block !== undefined &&
                x >= block.x &&
                x < block.x + block.width &&
                y >= block.y &&
                y < block.y + block.height;
            const [r, g, b] = inBlock ? block.colour : WHITE;
            const at = (y * width + x) * 4;
            png.data[at] = r;
            png.data[at + 1] = g;
            png.data[at + 2] = b;
            png.data[at + 3] = 255;
        }
    }
    return PNG.sync.write(png);
}

const options = { pixelThreshold: 0.1 };

describe("comparePngs", () => {
    it("finds nothing when the two images are the same", () => {
        const one = image(100, 80, { x: 10, y: 10, width: 40, height: 20, colour: NAVY });

        const { comparison } = comparePngs(one, one, options);

        expect(comparison.diffPixels).toBe(0);
        expect(comparison.diffRatio).toBe(0);
        expect(comparison.sizeMismatch).toBe(false);
        expect(comparison.comparedPixels).toBe(8000);
    });

    /*
     * A colour change is what the gate exists to catch, and the number it reports is the number a
     * threshold is read against. 800 of 8000 pixels is a tenth of the page, so a page allowing a
     * thousandth fails and one allowing a fifth does not.
     */
    it("counts a heading that changed colour, and nothing else", () => {
        const block = { x: 10, y: 10, width: 40, height: 20 };
        const before = image(100, 80, { ...block, colour: NAVY });
        const after = image(100, 80, { ...block, colour: RUST });

        const { comparison, diff } = comparePngs(before, after, options);

        expect(comparison.diffPixels).toBe(800);
        expect(comparison.diffRatio).toBeCloseTo(0.1, 10);
        expect(PNG.sync.read(diff)).toMatchObject({ width: 100, height: 80 });
    });

    it("ignores a colour shift smaller than the tolerance, and sees one larger", () => {
        const block = { x: 0, y: 0, width: 100, height: 80 };
        const before = image(100, 80, { ...block, colour: [120, 120, 120] });
        const nudged = image(100, 80, { ...block, colour: [122, 121, 120] });

        expect(comparePngs(before, nudged, { pixelThreshold: 0.1 }).comparison.diffPixels).toBe(0);
        expect(comparePngs(before, nudged, { pixelThreshold: 0 }).comparison.diffPixels).toBe(8000);
    });

    /*
     * Two full page screenshots are rarely the same height, and a footer that grew is a real
     * difference rather than a crash. Both images are padded to the larger size in their own marker
     * colour, so the area only one of them has counts as different.
     */
    it("compares pages of different heights, and counts the extra area as different", () => {
        const short = image(100, 80);
        const tall = image(100, 100);

        const { comparison } = comparePngs(short, tall, options);

        expect(comparison.sizeMismatch).toBe(true);
        expect(comparison.canvas).toEqual({ width: 100, height: 100 });
        expect(comparison.comparedPixels).toBe(10000);
        expect(comparison.diffPixels).toBe(2000);
        expect(comparison.reference).toEqual({ width: 100, height: 80 });
        expect(comparison.rebuilt).toEqual({ width: 100, height: 100 });
    });

    it("counts the corner neither image reaches, rather than matching two blank areas", () => {
        const tall = image(80, 120);
        const wide = image(120, 80);

        const { comparison } = comparePngs(tall, wide, options);

        expect(comparison.canvas).toEqual({ width: 120, height: 120 });
        // Everything outside the 80x80 both images cover, the shared corner included.
        expect(comparison.diffPixels).toBe(120 * 120 - 80 * 80);
    });
});

describe("asPercent", () => {
    it("keeps enough digits to tell a tenth of a percent from a hundredth", () => {
        expect(asPercent(0.001)).toBe("0.100%");
        expect(asPercent(0.0001)).toBe("0.010%");
        expect(asPercent(0)).toBe("0.000%");
    });
});
