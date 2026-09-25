import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { addressOf, loadPairs, masksFor, parsePairs, withinAllowance, type Env, type Pair } from "./pairs.js";

const baseDir = "/sites/rckoronadal/look";

const minimal = {
    defaults: { rebuiltBase: "https://staging.example" },
    pairs: [{ id: "home", reference: "prototypes/comp.html", rebuilt: "/" }],
};

const parse = (raw: unknown, env: Env = {}): Pair[] => parsePairs(raw, { baseDir, env });

const problems = (raw: unknown, env: Env = {}): string => {
    try {
        parse(raw, env);
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error("the pair list was accepted, and it should not have been");
};

describe("parsePairs", () => {
    it("fills in the widths, the threshold and the clock so a short list is a whole one", () => {
        const pairs = parse(minimal);

        expect(pairs).toHaveLength(1);
        expect(pairs[0].widths).toEqual([390, 1280]);
        expect(pairs[0].maxDiffRatio).toBe(0.001);
        expect(pairs[0].fullPage).toBe(true);
        expect(Number.isNaN(Date.parse(pairs[0].fixedTime))).toBe(false);
    });

    it("reads a bare relative string as a prototype on disk, next to the pair list", () => {
        const pairs = parse(minimal);

        expect(pairs[0].reference).toMatchObject({
            kind: "file",
            location: "/sites/rckoronadal/look/prototypes/comp.html",
        });
    });

    it("joins a path onto the base, and leaves a full URL alone", () => {
        const pairs = parse({
            defaults: { rebuiltBase: "https://staging.example" },
            pairs: [
                { id: "home", reference: "comp.html", rebuilt: "/" },
                { id: "news", reference: "comp.html", rebuilt: "/news/" },
                { id: "old", reference: "https://rckoronadal.org/", rebuilt: "https://elsewhere.example/x" },
            ],
        });

        expect(pairs).toHaveLength(3);
        expect(pairs[0].rebuilt.location).toBe("https://staging.example/");
        expect(pairs[1].rebuilt.location).toBe("https://staging.example/news/");
        expect(pairs[2].reference).toMatchObject({ kind: "url", location: "https://rckoronadal.org/" });
        expect(pairs[2].rebuilt.location).toBe("https://elsewhere.example/x");
    });

    it("expands a name from the environment, because the rebuilt host changes and the list does not", () => {
        const pairs = parse(
            { defaults: { rebuiltBase: "${REBUILT_BASE}" }, pairs: [{ id: "home", reference: "c.html", rebuilt: "/" }] },
            { REBUILT_BASE: "https://new.example" },
        );

        expect(pairs[0].rebuilt.location).toBe("https://new.example/");
    });

    it("refuses a name that is not set, rather than joining onto nothing", () => {
        const message = problems({
            defaults: { rebuiltBase: "${REBUILT_BASE}" },
            pairs: [{ id: "home", reference: "c.html", rebuilt: "/" }],
        });

        expect(message).toContain("${REBUILT_BASE}");
        expect(message).toContain("not set in the environment");
    });

    /*
     * The one that matters most. A gate whose threshold key was misspelled would pass everything
     * and look healthy doing it, so an unknown key is refused wherever it appears.
     */
    it("refuses an unknown key instead of ignoring it", () => {
        const message = problems({
            defaults: { rebuiltBase: "https://s.example", maxdiffratio: 0.5 },
            pairs: [{ id: "home", reference: "c.html", rebuilt: "/", treshold: 0.4 }],
        });

        expect(message).toContain("defaults.maxdiffratio: unknown key");
        expect(message).toContain("pairs[0].treshold: unknown key");
    });

    it("names every problem at once, so the file is fixed in one go", () => {
        const message = problems({
            defaults: { rebuiltBase: "https://s.example", widths: [10] },
            pairs: [
                { id: "home", reference: "c.html", rebuilt: "/", maxDiffRatio: 4 },
                { id: "home", reference: "c.html", rebuilt: "/" },
                { reference: "c.html", rebuilt: "/" },
            ],
        });
        const lines = message.split("\n");

        expect(lines.length).toBeGreaterThanOrEqual(4);
        expect(message).toContain("defaults.widths[0]");
        expect(message).toContain("pairs[0].maxDiffRatio");
        expect(message).toContain("which an earlier pair already used");
        expect(message).toContain("pairs[2].id");
    });

    it("refuses a reference that is both a file and a URL", () => {
        const message = problems({
            pairs: [{ id: "home", reference: { file: "c.html", url: "https://x.example" }, rebuilt: "https://y.example" }],
        });

        expect(message).toContain("A reference is one or the other");
    });

    it("refuses a path with no base, and says which key to set", () => {
        const message = problems({ pairs: [{ id: "home", reference: "c.html", rebuilt: "/about" }] });

        expect(message).toContain("defaults.rebuiltBase");
    });

    it("keeps a global mask and adds the page's own, per side", () => {
        const pairs = parse({
            defaults: { rebuiltBase: "https://s.example", mask: [".site-clock"] },
            pairs: [
                {
                    id: "home",
                    reference: "c.html",
                    rebuilt: "/",
                    mask: { both: [".weather"], reference: ["#comp-feed"], rebuilt: [".news-feed"] },
                },
            ],
        });

        expect(pairs).toHaveLength(1);
        expect(masksFor(pairs[0], "reference")).toEqual([".site-clock", ".weather", "#comp-feed"]);
        expect(masksFor(pairs[0], "rebuilt")).toEqual([".site-clock", ".weather", ".news-feed"]);
    });

    it("lets a page carry its own threshold, because the variable page is not every page", () => {
        const pairs = parse({
            defaults: { rebuiltBase: "https://s.example", maxDiffRatio: 0.0005 },
            pairs: [
                { id: "home", reference: "c.html", rebuilt: "/" },
                { id: "news", reference: "c.html", rebuilt: "/news", maxDiffRatio: 0.01 },
            ],
        });

        expect(pairs).toHaveLength(2);
        expect(pairs[0].maxDiffRatio).toBe(0.0005);
        expect(pairs[1].maxDiffRatio).toBe(0.01);
    });

    it("takes a pixel count beside the ratio, for a page tall enough to dilute any ratio", () => {
        const pairs = parse({
            defaults: { rebuiltBase: "https://s.example", maxDiffPixels: 0 },
            pairs: [
                { id: "changelog", reference: "c.html", rebuilt: "/changelog" },
                { id: "home", reference: "c.html", rebuilt: "/", maxDiffPixels: 20 },
            ],
        });
        expect(pairs).toHaveLength(2);
        expect(pairs[0].maxDiffPixels).toBe(0);
        expect(pairs[1].maxDiffPixels).toBe(20);
        expect(parse(minimal)[0].maxDiffPixels).toBeUndefined();

        const message = problems({
            defaults: { rebuiltBase: "https://s.example" },
            pairs: [{ id: "home", reference: "c.html", rebuilt: "/", maxDiffPixels: 2.5 }],
        });
        expect(message).toContain("pairs[0].maxDiffPixels");
    });

    it("fails a tall page on a few thousand changed pixels its ratio would let through", () => {
        // A section of a changelog 250,000px tall at 390px: well under a tenth of a percent.
        const section = { diffPixels: 90_000, diffRatio: 90_000 / (390 * 250_000) };
        expect(withinAllowance({ maxDiffRatio: 0.001 }, section)).toBe(true);
        expect(withinAllowance({ maxDiffRatio: 0.001, maxDiffPixels: 50 }, section)).toBe(false);
        expect(withinAllowance({ maxDiffRatio: 0.001, maxDiffPixels: 50 }, { diffPixels: 13, diffRatio: 13 / (390 * 9588) })).toBe(true);
        expect(withinAllowance({ maxDiffRatio: 0.001, maxDiffPixels: 1_000_000 }, { diffPixels: 5000, diffRatio: 0.01 })).toBe(false);
    });

    it("gives a tall page longer to capture, and refuses a timeout that is not a whole number of milliseconds", () => {
        const pairs = parse({
            defaults: { rebuiltBase: "https://s.example" },
            pairs: [
                { id: "home", reference: "c.html", rebuilt: "/" },
                { id: "changelog", reference: "c.html", rebuilt: "/changelog", timeout: 180_000 },
            ],
        });

        expect(pairs).toHaveLength(2);
        expect(pairs[0].timeout).toBe(30_000);
        expect(pairs[1].timeout).toBe(180_000);
        expect(problems({ ...minimal, pairs: [{ ...minimal.pairs[0], timeout: -5 }] })).toContain("pairs[0].timeout");
    });

    it("refuses an id that would not make a directory name", () => {
        const message = problems({ pairs: [{ id: "../etc", reference: "c.html", rebuilt: "https://y.example" }] });

        expect(message).toContain("because it is a directory name");
    });

    it("refuses an empty pair list", () => {
        expect(problems({ pairs: [] })).toContain("non-empty");
    });
});

describe("addressOf", () => {
    it("turns a prototype on disk into a file URL", () => {
        expect(addressOf({ kind: "file", location: "/sites/comp.html", click: [] })).toBe("file:///sites/comp.html");
    });

    it("carries a page state on the hash, with or without the hash character", () => {
        expect(addressOf({ kind: "file", location: "/sites/comp.html", hash: "about", click: [] })).toBe(
            "file:///sites/comp.html#about",
        );
        expect(addressOf({ kind: "url", location: "https://x.example/p", hash: "#two", click: [] })).toBe(
            "https://x.example/p#two",
        );
    });

    it("replaces a hash the URL already carried rather than appending a second one", () => {
        expect(addressOf({ kind: "url", location: "https://x.example/p#one", hash: "#two", click: [] })).toBe(
            "https://x.example/p#two",
        );
    });
});

/*
 * The pair lists this repository commits, read the way a run reads them.
 *
 * Nothing in CI runs a fixture site's look check: it needs a built app and a browser, and the one
 * that matters is deliberately red. So without this, a typo in a committed pair list is found the
 * next time somebody tries to use it, which is during a migration. `maxDiffratio` was the example
 * in this file's own header, and it applies to the lists here as much as to a site's.
 */
describe("the pair lists committed in look/fixtures", () => {
    const here = dirname(fileURLToPath(import.meta.url));

    function lists(dir: string): string[] {
        return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) return lists(full);
            return entry.name.endsWith("pairs.json") ? [full] : [];
        });
    }

    const files = lists(join(here, "fixtures"));

    it("finds them", () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)("%s parses, and names both gate widths", (file) => {
        const pairs = loadPairs(file, { REBUILT_BASE: "http://127.0.0.1:3210" });

        expect(pairs.length).toBeGreaterThan(0);
        for (const pair of pairs) {
            // 390 and 1280 are the widths BaryoDev/barakoCMS#959 reads the gate at.
            expect(pair.widths, pair.id).toContain(390);
            expect(pair.widths, pair.id).toContain(1280);
            expect(pair.maxDiffRatio, pair.id).toBeGreaterThan(0);
        }
    });

    it.each(files)("%s points at a reference that is on disk", (file) => {
        const pairs = loadPairs(file, { REBUILT_BASE: "http://127.0.0.1:3210" });

        expect(pairs.length).toBeGreaterThan(0);
        for (const pair of pairs) {
            if (pair.reference.kind !== "file") continue;
            expect(existsSync(pair.reference.location), `${pair.id}: ${pair.reference.location}`).toBe(true);
        }
    });
});
