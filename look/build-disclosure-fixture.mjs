#!/usr/bin/env node
// Renders a faq of three faqItems that share one group, the second starting open, each answer
// holding a link, through the real compiled package (dist, built by npm run build:package first).
// The disclosure needs no script, so the page is the rendered markup and nothing else.
// disclosure.component.pw.ts loads it into a real browser.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineConfig } from "../dist/config.js";
import { bindBlocks } from "../dist/blocks/bind.js";
import { BlockList } from "../dist/blocks/render.js";
import { createBlockRegistry } from "../dist/blocks/registry.js";
import { resolveBlocks } from "../dist/blocks/schema.js";

const here = dirname(fileURLToPath(import.meta.url));

async function render() {
    const config = defineConfig({
        site: { name: "Disclosure test", url: "https://disclosure.example" },
        cmsUrl: "http://cms.test",
    });
    const registry = createBlockRegistry(config);
    const item = (name, start) => ({
        type: "faqItem",
        props: {
            question: `Question ${name}`,
            answer: `Answer ${name} has a zebrafish in it. [Link ${name}](https://example.test/${name.toLowerCase()})`,
            group: "ledger",
            ...(start ? { start } : {}),
        },
    });
    const raw = [{ type: "faq", props: { items: [[item("A"), item("B", "open"), item("C")]] } }];
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config, registry, scopes: {} });
    const body = renderToStaticMarkup(createElement(BlockList, { blocks: bound, theme: config.theme }));
    const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:sans-serif}</style>';
    return { page: `<!doctype html><html><head>${head}</head><body>${body}</body></html>` };
}

writeFileSync(join(here, "disclosure-fixture.generated.json"), JSON.stringify(await render()));
