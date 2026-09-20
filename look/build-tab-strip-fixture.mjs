#!/usr/bin/env node
// Renders the exact four-tab shape codeTabs compiles the baryo.dev fixture's install band into,
// through the real compiled package (dist, built by npm run build:package first), and writes it as
// one self-contained HTML file for a Playwright test to load with page.setContent.
//
// Run as plain Node, never through Playwright's own test transform: that transform gives a `.tsx`
// file's JSX its own runtime, meant for mounting components inside a browser, not for handing the
// result to react-dom/server. Rendered here, the test that reads the file touches no React or
// `next/*` import at all, only a static string.
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

export const LABELS = ["barakoCMS", "barakoBrew", "barakoPress", "BaryoVM"];
export const PRIMARY_CODE = "dotnet add package BarakoCMS";
export const LAST_TAB_CODE = "dotnet tool install -g BaryoVM";

async function render() {
    const config = defineConfig({ site: { name: "Tab strip test", url: "https://tabtest.example" } });
    const registry = createBlockRegistry(config);
    const raw = [
        {
            type: "codeTabs",
            props: {
                code: PRIMARY_CODE,
                primaryLabel: LABELS[0],
                items: [
                    [
                        { type: "codeTab", props: { label: LABELS[1], code: "npm i -g barako-brew" } },
                        { type: "codeTab", props: { label: LABELS[2], code: "npm i barakopress" } },
                        { type: "codeTab", props: { label: LABELS[3], code: LAST_TAB_CODE } },
                    ],
                ],
            },
        },
    ];
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config, registry, scopes: {} });
    const body = renderToStaticMarkup(createElement(BlockList, { blocks: bound, theme: config.theme }));
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

const html = await render();
writeFileSync(join(here, "tab-strip-fixture.generated.html"), html);
