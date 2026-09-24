#!/usr/bin/env node
// Renders real pages through the real compiled package (dist, built by npm run build:package
// first) and writes each as one self-contained HTML file for viewport.component.pw.ts to load
// with page.setContent. Run as plain Node under the next stub loader, the same way
// build-tab-strip-fixture.mjs renders the tab strip: PageView is a server component, and handing
// its output straight to react-dom/server touches no `next/*` runtime at all.
//
// barakoPress #101: a long unbroken token in running text, and a pre losing its own overflow-x
// scroller to a flex ancestor, both laid a page out wider than a 390px viewport. Two fixtures:
//
//   long-token   a document containing the long unbroken token the issue measured, standing in
//                for /changelog, /community, /modules and every document page.
//   baryo-home   the real baryo.dev home page fixture the look check already holds (#83, #91),
//                so the same guard is proven over content this repo already carries, not only a
//                case built to fit the fix.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineConfig } from "../dist/config.js";
import { createBlockRegistry } from "../dist/blocks/registry.js";
import { pageBlocks } from "../dist/screens/page.js";
import { BlockList } from "../dist/blocks/render.js";
import { BLOCK_PROSE_CLASS } from "../dist/blocks/built-in.js";
import { proseCss } from "../dist/theme.js";

const here = dirname(fileURLToPath(import.meta.url));

// The exact shape measured in the issue: a binding name long enough to have nowhere to break.
export const LONG_TOKEN = "PublicDelivery:RequireAcknowledgement";
// Longer still, and inside a fenced code block rather than running text, for the second cause: a
// `pre` nested in a `stack` cell, the shape a document page composes its blocks in.
export const LONG_COMMAND =
    "curl -fsSL https://get.baryo.dev/install-barakocms-with-a-token-too-long-to-wrap-or-to-shrink | sh";
// A URL written as its own link text, which is how a changelog entry cites a wiki page. Measured on
// barakocms.com's rebuilt /changelog, where it laid a 390px viewport out 603px wide: the prose rule
// gave `code` somewhere to break and gave `a` nothing.
export const LONG_LINK = "https://github.com/BaryoDev/barakoCMS/wiki/barakoCMS-configuration-reference";
// A package id in a heading, the shape that laid the same site's /modules out 403px wide. The text
// primitive sets no wrapping rule at all, so a token with no break opportunity sizes its grid cell.
export const LONG_NAME = "BarakoCMS.Analytics.Umami";

// PageView itself is an async server component, which plain react-dom/server (no RSC renderer
// here, same as build-tab-strip-fixture.mjs) cannot render directly. `pageBlocks` does the async
// half; this rebuilds the sync half of PageView's own markup around it, close enough for a
// geometry check that never looks at the title or the breadcrumbs.
async function renderPage(page) {
    const config = defineConfig({ site: { name: "Viewport test", url: "https://viewport.example" } });
    const registry = createBlockRegistry(config);
    const full = { id: "p", slug: "p", title: "Viewport test", body: "", hideTitle: false, ...page };
    const blocks = await pageBlocks(config, full, registry);
    const t = config.theme;
    const body = renderToStaticMarkup(
        createElement(
            "div",
            { style: { background: t.colors.pageBg, color: t.colors.ink, fontFamily: t.fonts.body } },
            createElement("style", { dangerouslySetInnerHTML: { __html: proseCss(t, BLOCK_PROSE_CLASS) } }),
            createElement(
                "main",
                { style: { maxWidth: t.layout.wide, margin: "0 auto", padding: `56px ${t.layout.gutter} 80px` } },
                createElement(BlockList, { blocks, theme: t }),
            ),
        ),
    );
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${body}</body></html>`;
}

async function longToken() {
    return renderPage({
        title: "Changelog",
        blocks: [
            {
                type: "richText",
                props: {
                    markdown: `Set \`${LONG_TOKEN}\` in appsettings, or see the docs for what it does.`,
                },
            },
            {
                type: "stack",
                props: {
                    content: [[{ type: "richText", props: { markdown: "```shell\n" + LONG_COMMAND + "\n```" } }]],
                },
            },
            {
                type: "richText",
                props: { markdown: `- See [${LONG_LINK}](${LONG_LINK}) for the rest.` },
            },
            {
                type: "text",
                props: { value: LONG_NAME, variant: "heading" },
            },
        ],
    });
}

async function baryoHome() {
    const blocks = JSON.parse(readFileSync(join(here, "fixtures/baryo-dev/home.blocks.json"), "utf8"));
    return renderPage({ title: "barakoCMS", blocks });
}

writeFileSync(join(here, "viewport-long-token.generated.html"), await longToken());
writeFileSync(join(here, "viewport-baryo-home.generated.html"), await baryoHome());
