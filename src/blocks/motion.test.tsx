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

/*
 * The markup with every `aria-hidden` subtree cut out, tags counted so a nested one goes with it.
 * What is left is what a reader is read, and a block whose only copy of its words was inside an
 * animated stack has nothing left here.
 */
function readable(html: string): string {
    /*
     * The stylesheets go first. A count-up's target number is in its keyframes, so leaving them in
     * would let a block with no readable copy of its figure pass on its own CSS. Cut by index and
     * repeated until there is none left, rather than one pass of a pattern: a single pass over
     * markup can leave behind the very thing it was removing.
     */
    let out = html;
    for (let at = out.indexOf("<style"); at !== -1; at = out.indexOf("<style")) {
        const end = out.indexOf("</style>", at);
        out = end === -1 ? out.slice(0, at) : out.slice(0, at) + out.slice(end + "</style>".length);
    }
    for (;;) {
        const found = out.search(/<([a-z]+)[^>]*aria-hidden="true"/);
        if (found === -1) return out;
        const tag = /<([a-z]+)/.exec(out.slice(found))?.[1] ?? "";
        const open = new RegExp(`<${tag}[\\s>]`, "g");
        const close = `</${tag}>`;
        let depth = 0;
        let i = found;
        for (; i < out.length; ) {
            open.lastIndex = i;
            const next = open.exec(out);
            const shut = out.indexOf(close, i);
            if (shut === -1) return out.slice(0, found);
            if (next && next.index < shut) {
                depth++;
                i = next.index + 1;
                continue;
            }
            if (--depth === 0) {
                i = shut + close.length;
                break;
            }
            i = shut + close.length;
        }
        out = out.slice(0, found) + out.slice(i);
    }
}

/*
 * The rule the two accessibility findings on #79 were both instances of: whatever a motion block
 * animates is presentation, so it is never the only copy of what the block says. One test over every
 * motion block, rather than one per block, because the next animated block is the one at risk.
 */
describe("what a motion block says is in the accessibility tree", () => {
    const cases: { what: string; block: unknown; reads: string[] }[] = [
        {
            what: "a rotation",
            block: { type: "rotatingText", props: { items: "fast, plain, yours", seconds: 2 } },
            reads: ["fast"],
        },
        {
            what: "a figure counting up",
            block: { type: "text", props: { value: "1200", motion: "countUp" } },
            reads: ["1200"],
        },
        {
            what: "a terminal",
            block: { type: "typingTerminal", props: { lines: "npm i barakopress", prompt: "$" } },
            reads: ["$ npm i barakopress"],
        },
        {
            what: "a revealed section",
            block: { type: "reveal", props: { content: [[{ type: "text", props: { value: "Still here" } }]] } },
            reads: ["Still here"],
        },
        {
            what: "a code sample",
            block: { type: "codeSample", props: { code: "npm i barakopress", language: "shell" } },
            reads: ["npm i barakopress"],
        },
    ];

    it.each(cases)("$what keeps one plain copy of what it says", async ({ block, reads }) => {
        const html = await page([block]);
        const left = readable(html);

        expect(reads.length).toBeGreaterThan(0);
        for (const word of reads) {
            expect(html).toContain(word);
            expect(left).toContain(word);
        }
    });

    it("says a rotation's later words once, and not as one run of text", async () => {
        const html = await page([{ type: "rotatingText", props: { items: "fast, plain, yours" } }]);

        // Every word is drawn, and the stack they are drawn in is presentational, so what is read
        // is the one word that stands when nothing animates.
        expect(html).toContain(">plain<");
        expect(html).toContain('aria-hidden="true"');
        const left = readable(html);
        expect(left).toContain("fast");
        expect(left).not.toContain("plain");
        expect(left).not.toContain("yours");
    });
});

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

/*
 * The accordion of #235. `<details name>` closes the others with nothing loaded, so what is tested
 * here is the markup that mechanism needs and the CSS that animates it. The timing itself is a
 * browser's to draw and is checked by hand, see the issue.
 */
describe("the disclosure's open and close motion (#235)", () => {
    const ledger = (items: { question: string; open?: boolean }[], group = "ledger") =>
        page([
            {
                type: "faq",
                props: {
                    items: [
                        items.map((i) => ({
                            type: "faqItem",
                            props: {
                                question: i.question,
                                answer: `About ${i.question}`,
                                group,
                                ...(i.open ? { start: "open" } : {}),
                            },
                        })),
                    ],
                },
            },
        ]);

    const one = () => page([{ type: "disclosure", props: { label: "One", content: [[]] } }]);

    it("animates grid-template-rows from 0fr to 1fr over .4s on the issue's easing", async () => {
        const css = styles(await one());

        expect(css).toContain("grid-template-rows:0fr");
        expect(css).toContain("grid-template-rows:1fr");
        expect(css).toContain("transition:grid-template-rows .4s cubic-bezier(.2,.8,.2,1)");
        // Without this the content is cut off at once on close and the row has nothing to shrink.
        expect(css).toContain("content-visibility .4s allow-discrete");
    });

    it("scopes the rules to the disclosure and to browsers that have ::details-content", async () => {
        const css = styles(await one());

        expect(css.startsWith("@supports selector(::details-content){")).toBe(true);
        expect(css).toContain("details[data-bp-disclosure]::details-content{");
        expect(css).toContain("details[data-bp-disclosure][open]::details-content{");
        expect(css).not.toMatch(/(^|[{}])::details-content/);
    });

    it("clips the panel without cutting a focus ring at its edge", async () => {
        const css = styles(await one());

        expect(css).toContain("overflow:clip;overflow-clip-margin:6px");
        expect(css).not.toContain("overflow:hidden");
    });

    it("leaves a reduced-motion visitor with no motion rule at all", async () => {
        const left = unguarded(styles(await one()));

        expect(left).not.toContain("transition");
        expect(left).not.toContain("grid-template-rows");
        expect(left).not.toContain("details-content");
        expect(left).not.toContain("overflow");
    });

    it("wraps the panel so the row can collapse, and keeps the style out of the details", async () => {
        const html = await one();

        expect(html).toMatch(/<details[^>]*data-bp-disclosure/);
        expect(html).toMatch(/<\/summary><div data-bp-panel="">/);
        // The style is a sibling before it, so the last child of a details is still its content.
        expect(html).toMatch(/<\/style><details/);
        expect(html).toMatch(/<\/div><\/div><\/details>/);
    });

    it("puts one group name on every details of a faq, so opening one closes the others", async () => {
        const html = await ledger([{ question: "A" }, { question: "B" }, { question: "C" }]);

        expect(html.match(/<details[^>]*name="ledger"/g)).toHaveLength(3);
    });

    it("opens the item that starts open and only that one", async () => {
        const html = await ledger([{ question: "A", open: true }, { question: "B" }, { question: "C" }]);

        expect(html.match(/<details/g)).toHaveLength(3);
        expect(html.match(/<details[^>]*open=""/g)).toHaveLength(1);
        expect(html).toMatch(/<details[^>]*open=""[^>]*>\s*<summary[^>]*>A</);
    });

    it("renders start closed and start left out as one closed details each", async () => {
        for (const props of [{ start: "closed" }, {}]) {
            const html = await page([{ type: "faqItem", props: { question: "A", answer: "a", ...props } }]);
            expect(html.match(/<details/g)).toHaveLength(1);
            expect(html).not.toContain('open=""');
        }
    });

    it("builds a nine item ledger from faq items with the first open (markup only)", async () => {
        const items = Array.from({ length: 9 }, (_, i) => ({ question: `Q${i + 1}`, open: i === 0 }));
        const html = await ledger(items);

        expect(html.match(/<details[^>]*name="ledger"/g)).toHaveLength(9);
        expect(html.match(/<details[^>]*open=""/g)).toHaveLength(1);
    });

    it("leaves faq items independent when no group is given", async () => {
        const html = await page([
            { type: "faq", props: { items: [[{ type: "faqItem", props: { question: "A", answer: "a" } }]] } },
        ]);

        expect(html).toContain("<details");
        expect(html).not.toContain("name=");
    });

    it("keeps a faqItem at the same block cost as before: one disclosure and one richText", () => {
        // A preset's body is what the bind pass spends the page budget on, per item. Master's body
        // was these two blocks; a showIf pair around two disclosures made it six.
        const walk = (list: { slots?: Record<string, unknown[][]> }[]): number =>
            list.reduce(
                (n, b) =>
                    n + 1 + Object.values(b.slots ?? {}).reduce((m, lists) => m + lists.reduce((k, l) => k + walk(l as never), 0), 0),
                0,
            );
        const body = registry.get("faqItem")?.preset ?? [];

        expect(walk(body as never)).toBe(2);
        // A nine item ledger is then the faq, its nine items and two blocks under each.
        expect(1 + 9 + 9 * walk(body as never)).toBe(28);
    });
});
