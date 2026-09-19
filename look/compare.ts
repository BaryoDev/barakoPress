/*
 * The comparison, which is the only part of the check with an opinion about pass and fail.
 *
 * Two full page screenshots are rarely the same size: a rebuilt page whose footer grew by eight
 * pixels is a real difference, not a reason to crash. So both images are padded to the size of the
 * larger, each with its own marker colour, and the padded area counts as differing. The two colours
 * differ from each other so that the corner where both are padded still reads as a difference
 * rather than quietly matching.
 */

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Size {
    width: number;
    height: number;
}

export interface Comparison {
    /** The size everything was compared at: the larger of the two in each direction. */
    canvas: Size;
    reference: Size;
    rebuilt: Size;
    diffPixels: number;
    comparedPixels: number;
    /** diffPixels over comparedPixels, which is what the threshold is read against. */
    diffRatio: number;
    sizeMismatch: boolean;
}

export interface CompareResult {
    comparison: Comparison;
    /** The diff image: the reference faded out with every differing pixel painted over it. */
    diff: Buffer;
}

const REFERENCE_PAD: [number, number, number, number] = [255, 0, 255, 255];
const REBUILT_PAD: [number, number, number, number] = [0, 255, 255, 255];

export interface CompareOptions {
    /** Per pixel colour distance tolerated, 0 to 1. Larger tolerates more. */
    pixelThreshold: number;
}

export function comparePngs(reference: Buffer, rebuilt: Buffer, options: CompareOptions): CompareResult {
    const left = PNG.sync.read(reference);
    const right = PNG.sync.read(rebuilt);

    const canvas: Size = {
        width: Math.max(left.width, right.width),
        height: Math.max(left.height, right.height),
    };
    const sizeMismatch = left.width !== right.width || left.height !== right.height;

    const paddedLeft = padTo(left, canvas, REFERENCE_PAD);
    const paddedRight = padTo(right, canvas, REBUILT_PAD);
    const diff = new PNG({ width: canvas.width, height: canvas.height });

    const diffPixels = pixelmatch(paddedLeft.data, paddedRight.data, diff.data, canvas.width, canvas.height, {
        threshold: options.pixelThreshold,
        // Anti-aliased pixels are left out. Text rendering wobbles by a subpixel between two runs of
        // the same browser, and counting that turns every page into noise. A colour change fills the
        // inside of a glyph, not only its edge, so it still registers.
        includeAA: false,
        alpha: 0.2,
    });

    const comparedPixels = canvas.width * canvas.height;
    return {
        comparison: {
            canvas,
            reference: { width: left.width, height: left.height },
            rebuilt: { width: right.width, height: right.height },
            diffPixels,
            comparedPixels,
            diffRatio: comparedPixels === 0 ? 0 : diffPixels / comparedPixels,
            sizeMismatch,
        },
        diff: PNG.sync.write(diff),
    };
}

function padTo(image: PNG, canvas: Size, fill: [number, number, number, number]): PNG {
    if (image.width === canvas.width && image.height === canvas.height) return image;

    const padded = new PNG({ width: canvas.width, height: canvas.height });
    for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
            const to = (y * canvas.width + x) * 4;
            if (x < image.width && y < image.height) {
                const from = (y * image.width + x) * 4;
                padded.data[to] = image.data[from];
                padded.data[to + 1] = image.data[from + 1];
                padded.data[to + 2] = image.data[from + 2];
                padded.data[to + 3] = image.data[from + 3];
            } else {
                padded.data[to] = fill[0];
                padded.data[to + 1] = fill[1];
                padded.data[to + 2] = fill[2];
                padded.data[to + 3] = fill[3];
            }
        }
    }
    return padded;
}

/** Reads as a percentage with enough digits to tell a threshold of 0.1% from one of 0.01%. */
export function asPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(3)}%`;
}
