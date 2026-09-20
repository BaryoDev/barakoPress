import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The motion blocks of #22.
 *
 * One rule decides whether any of these may ship: the page a visitor gets with JavaScript off, and
 * the page a visitor who asked for reduced motion gets, is the finished page. So every test here
 * asks the same two questions. Is the final state in the markup, and is every animation inside the
 * guard that a reduced-motion visitor never enters.
 */
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

const { defineConfig } = await import("../config.js");
const { createBlockRegistry } = await import("./registry.js");
const { BlockList } = await import("./render.js");
const { resolveBlocks } = await import("./schema.js");
const { bindBlocks } = await import("./bind.js");
const { toneOf } = await import("./tokens.js");

const config = defineConfig({ site: { name: "Baryo", url: "https://baryo.example" }, cmsUrl: "http://cms.test" });
const registry = createBlockRegistry(config);

async function page(raw: unknown[]): Promise<string> {
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config, registry, scopes: {} });
    return renderToStaticMarkup(<BlockList blocks={bound} theme={config.theme} />);
}

/** The CSS in a rendered page, which is where all of the motion is. */
function styles(html: string): string {
    return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
}

/*
 * The same CSS with every `prefers-reduced-motion: no-preference` block taken out, braces counted so
 * a nested `@keyframes` or `@supports` goes with it. What is left is what a visitor who asked for
 * reduced motion gets, and nothing in it may animate or hide anything.
 *
 * The `@supports` wrapper is deliberately not stripped here. Stripping both would pass a block whose
 * animation sits under `@supports` alone, which is exactly the mistake this is here to catch.
 */
function unguarded(css: string): string {
    const guard = /@media \(prefers-reduced-motion:no-preference\)\{/;
    let out = css;
    for (let found = out.search(guard); found !== -1; found = out.search(guard)) {
        let depth = 0;
        let i = out.indexOf("{", found);
        for (; i < out.length; i++) {
            if (out[i] === "{") depth++;
            else if (out[i] === "}" && --depth === 0) break;
        }
        out = out.slice(0, found) + out.slice(i + 1);
    }
    // An `@supports` left holding nothing applies nothing, so it is not part of what is applied.
    return out.replace(/@supports[^{]*\{\s*\}/g, "");
}

describe("motion blocks render their final state", () => {
    it("types a terminal out in full, and animates only where motion is welcome", async () => {
        const html = await page([
            {
                type: "typingTerminal",
                props: { lines: "npm i barakopress\nnpx barakopress bindings-key baryo", prompt: "$", seconds: 8 },
            },
        ]);

        expect(html).toContain("$ npm i barakopress");
        expect(html).toContain("$ npx barakopress bindings-key baryo");

        const css = styles(html);
        expect(css).toContain("@media (prefers-reduced-motion:no-preference)");
        expect(unguarded(css)).not.toContain("animation");
        // The width a line types to is the line's own length, so nothing here is a size of its own.
        expect(html).toContain("--bp-w:19ch");
    });

    it("stands the first word of a rotation up, with the rest stacked behind it", async () => {
        const html = await page([
            { type: "rotatingText", props: { items: "fast, plain, yours", variant: "display", seconds: 2 } },
        ]);

        expect(html).toContain(">fast<");
        expect(html).toContain(">plain<");
        expect(html).toContain(">yours<");

        const css = styles(html);
        // The resting state: one word drawn, the others stacked in the same cell at nothing.
        expect(css).toContain(">span:not(:first-child){opacity:0}");
        expect(unguarded(css)).not.toContain("animation");
    });

    it("renders a figure as the figure, and covers it only where the count can run", async () => {
        const html = await page([
            { type: "statBand", props: { items: [[{ type: "stat", props: { value: "1200", label: "sites", motion: "countUp" } }]] } },
        ]);

        expect(html).toContain(">1200<");

        const css = styles(html);
        expect(css).toContain("@property");
        expect(css).toContain("to{--bp-cu-");
        // The digits in the markup are hidden only inside the block a browser without the view
        // timeline skips, which is the same block a reduced-motion visitor never enters.
        expect(css).toContain("visibility:hidden");
        expect(unguarded(css)).not.toContain("visibility:hidden");
        expect(unguarded(css)).not.toContain("animation");
    });

    it("leaves a figure that is not one plain number alone", async () => {
        const html = await page([{ type: "text", props: { value: "1,200+", motion: "countUp" } }]);

        expect(html).toContain("1,200+");
        expect(styles(html)).toBe("");
    });

    it("never parks a revealed section hidden", async () => {
        const html = await page([
            { type: "reveal", props: { content: [[{ type: "text", props: { value: "Still here" } }]] } },
        ]);

        expect(html).toContain("Still here");

        const css = styles(html);
        expect(css).toContain("@supports (animation-timeline:view())");
        const rest = unguarded(css);
        expect(rest).not.toContain("animation");
        expect(rest).not.toContain("opacity:0");
    });
});

describe("the tokens the motion blocks read", () => {
    it("draws a gradient band from the theme's own colours, and names none of its own", async () => {
        const html = await page([
            { type: "section", props: { tone: "gradient", content: [[{ type: "text", props: { value: "Contact" } }]] } },
        ]);

        const tone = toneOf(config.theme, "gradient");
        expect(tone.bg).toContain("linear-gradient");
        expect(tone.bg).toContain(config.theme.colors.inverse);
        expect(tone.bg).toContain(config.theme.colors.inverseAccent);
        expect(html).toContain("linear-gradient");
        expect(html).toContain("Contact");
    });

    it("turns a card grid's cells through the theme's hues, a cycle of three", async () => {
        const cells = [1, 2, 3, 4].map((n) => ({ type: "text", props: { value: `card ${n}` } }));
        const html = await page([{ type: "flow", props: { columns: "3", hueRotate: "wide", content: [cells] } }]);

        expect(html).toContain('data-bp-hue="wide"');
        const css = styles(html);
        expect(css).toContain("nth-child(3n+2){filter:hue-rotate(40deg)}");
        expect(css).toContain("nth-child(3n+3){filter:hue-rotate(-40deg)}");
        // A hue turn is not motion, so it is not behind the reduced-motion guard.
        expect(unguarded(css)).toContain("hue-rotate");
    });

    it("turns nothing when a flow was not asked to", async () => {
        const html = await page([
            { type: "flow", props: { columns: "3", content: [[{ type: "text", props: { value: "plain" } }]] } },
        ]);

        expect(html).not.toContain("data-bp-hue");
        expect(styles(html)).toBe("");
    });
});

describe("the blocks an editor is offered", () => {
    it("offers every motion block and the gradient tone", () => {
        const types = [...registry.keys()];
        expect(types.length).toBeGreaterThan(20);
        for (const type of ["reveal", "rotatingText", "typingTerminal", "codeSample"]) {
            expect(types).toContain(type);
        }

        const section = registry.get("section");
        const tones = section?.fields.find((f) => f.name === "tone")?.options ?? [];
        expect(tones).toContain("gradient");
        expect(tones).toContain("inverse");
    });

    it("offers the copy affordance as words the tenant types, not English written in here", async () => {
        const html = await page([
            { type: "codeSample", props: { code: "npm i barakopress", language: "shell", selectLabel: "Pindutin para kopyahin" } },
        ]);

        expect(html).toContain("npm i barakopress");
        expect(html).toContain("shell");
        expect(html).toContain("Pindutin para kopyahin");
        expect(html).toContain("user-select:all");

        // Nothing is said when the tenant said nothing, rather than a word chosen here.
        const bare = await page([{ type: "codeSample", props: { code: "npm i barakopress" } }]);
        expect(bare).toContain("npm i barakopress");
        expect(bare).not.toContain("user-select:all\">Copy");
    });
});
