#!/usr/bin/env node
// Renders a source holding a filterBar through the real compiled package (dist, built by npm run
// build:package first), with the CMS read answered here, and writes the page at rest plus the rule
// the bar writes for each value. filter-bar.component.pw.ts loads both into a real browser.
//
// Each row is a stickyBar, a transparent block, so its wrapper carries an inline display the rule
// has to win over. One value holds quotes, an ampersand and a closing style tag, and one a space.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineConfig } from "../dist/config.js";
import { bindBlocks } from "../dist/blocks/bind.js";
import { filterRule } from "../dist/blocks/filter.js";
import { BlockList } from "../dist/blocks/render.js";
import { createBlockRegistry } from "../dist/blocks/registry.js";
import { resolveBlocks } from "../dist/blocks/schema.js";

const here = dirname(fileURLToPath(import.meta.url));

export const HOSTILE = `Ops "&" </style> tools`;
export const ROWS = [
    { title: "Auth", category: "Auth" },
    { title: "SSO", category: "Auth" },
    { title: "Files", category: "Storage" },
    { title: "Metrics", category: HOSTILE },
    { title: "Mail", category: "Mail and chat" },
];

globalThis.fetch = async () =>
    Response.json({
        items: ROWS.map((row, i) => ({ id: `p${i}`, slug: `p${i}`, data: { Name: row.title, Category: row.category } })),
        page: 1,
        pageSize: 50,
        totalItems: ROWS.length,
        totalPages: 1,
        hasNextPage: false,
    });

async function render() {
    const config = defineConfig({
        site: { name: "Filter test", url: "https://filtertest.example" },
        cmsUrl: "http://cms.test",
        collections: { packages: { type: "package", fields: { title: "Name" } } },
    });
    const registry = createBlockRegistry(config);
    const raw = [
        {
            type: "source",
            props: {
                collection: "packages",
                mode: "list",
                content: [
                    [
                        { type: "filterBar", props: { field: "Category" } },
                        {
                            type: "repeat",
                            props: {
                                content: [
                                    [
                                        {
                                            type: "stickyBar",
                                            props: { content: [[{ type: "text", props: { value: "row {{item.Title}}" } }]] },
                                        },
                                    ],
                                ],
                            },
                        },
                    ],
                ],
            },
        },
    ];
    const resolved = resolveBlocks(raw, registry, { perViewer: false });
    const bound = await bindBlocks(resolved, { config, registry, scopes: {} });
    const bar = bound.find((block) => block.definition.type === "filterBar");
    const state = JSON.parse(String(bar?.props.state ?? "null"));
    if (!state) throw new Error("the filterBar did not bind");
    const body = renderToStaticMarkup(createElement(BlockList, { blocks: bound, theme: config.theme }));
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
    const rules = Object.fromEntries(state.values.map((value) => [value, filterRule(state.id, value)]));
    return { html, rules };
}

writeFileSync(join(here, "filter-bar-fixture.generated.json"), JSON.stringify(await render()));
