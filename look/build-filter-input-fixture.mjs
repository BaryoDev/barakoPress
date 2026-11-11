#!/usr/bin/env node
// Renders a source holding a filterBar, a filterInput and a repeat of two-block rows through the
// real compiled package (dist, built by npm run build:package first), with the CMS read answered
// here, and writes the page twice: with no script, and with the box's client code on it.
// filter-input.component.pw.ts loads both into a real browser.
//
// The client code is the compiled wireFilterInput, pasted in by toString because the page has no
// React to hydrate. It only runs if everything it reaches is pasted too: foldText, the attribute
// names, and anything else wireFilterInput calls. A helper added to filter-input.tsx outside that
// function, or an attribute constant it reads, has to be added to the list below, or this page
// throws and the look job fails with it.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineConfig } from "../dist/config.js";
import { bindBlocks } from "../dist/blocks/bind.js";
import { filterRule } from "../dist/blocks/filter.js";
import { FILTER_COUNT_ATTR, FILTER_EMPTY_ATTR, FILTER_INPUT_ATTR, FILTER_MISS_ATTR, FILTER_ROW_ATTR } from "../dist/blocks/filter.js";
import { wireFilterInput } from "../dist/blocks/filter-input.js";
import { foldText, SEARCH_COUNT_ATTR, SEARCH_EMPTY_ATTR, SEARCH_GROUP_ATTR, SEARCH_GROUP_EMPTY_ATTR, SEARCH_GROUPS_ATTR, SEARCH_INDEX_ATTR, SEARCH_ROOT_ATTR } from "../dist/blocks/search-attrs.js";
import { filterGroups, filterIndex, focusable, wireSearch } from "../dist/blocks/search-keys.js";
import { BlockList } from "../dist/blocks/render.js";
import { createBlockRegistry } from "../dist/blocks/registry.js";
import { resolveBlocks } from "../dist/blocks/schema.js";

const here = dirname(fileURLToPath(import.meta.url));

export const ROWS = [
    { title: "Auth", category: "Auth", summary: "Sign in and tokens" },
    { title: "SSO", category: "Auth", summary: "Single sign on" },
    { title: "Files", category: "Storage", summary: "Uploads and blobs" },
    { title: "Café", category: "Storage", summary: "Coffee orders" },
    { title: "Mail", category: "Mail", summary: "Sends email and chat" },
];

globalThis.fetch = async () =>
    Response.json({
        items: ROWS.map((row, i) => ({ id: `p${i}`, slug: `p${i}`, data: { Name: row.title, Category: row.category, Summary: row.summary } })),
        page: 1,
        pageSize: 50,
        totalItems: ROWS.length,
        totalPages: 1,
        hasNextPage: false,
    });

async function render() {
    const config = defineConfig({
        site: { name: "Filter input test", url: "https://filterinput.example" },
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
                        { type: "filterInput", props: {} },
                        {
                            type: "repeat",
                            props: {
                                content: [
                                    [
                                        { type: "stickyBar", props: { content: [[{ type: "text", props: { value: "row {{item.Title}}" } }]] } },
                                        { type: "text", props: { value: "about {{item.Summary}}" } },
                                        // Carries a stylesheet of its own, which is not text a reader reads.
                                        { type: "reveal", props: { content: [[{ type: "text", props: { value: "tail {{item.Title}}" } }]] } },
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
    const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:sans-serif}</style>';
    const script = `<script>
const FILTER_INPUT_ATTR = ${JSON.stringify(FILTER_INPUT_ATTR)};
const FILTER_COUNT_ATTR = ${JSON.stringify(FILTER_COUNT_ATTR)};
const FILTER_EMPTY_ATTR = ${JSON.stringify(FILTER_EMPTY_ATTR)};
const FILTER_MISS_ATTR = ${JSON.stringify(FILTER_MISS_ATTR)};
const FILTER_ROW_ATTR = ${JSON.stringify(FILTER_ROW_ATTR)};
${foldText.toString()}
${wireFilterInput.toString()}
wireFilterInput(document.querySelector("[data-bp-filter-input] input"));
</script>`;
    // A search block's box on the same page, wired before or after the filter box.
    const search = '<div data-bp-search><input type="search" id="site-search" aria-label="Site search"></div>';
    const searchScript = `<script>
const SEARCH_ROOT_ATTR = ${JSON.stringify(SEARCH_ROOT_ATTR)};
const SEARCH_INDEX_ATTR = ${JSON.stringify(SEARCH_INDEX_ATTR)};
const SEARCH_EMPTY_ATTR = ${JSON.stringify(SEARCH_EMPTY_ATTR)};
const SEARCH_GROUPS_ATTR = ${JSON.stringify(SEARCH_GROUPS_ATTR)};
const SEARCH_GROUP_ATTR = ${JSON.stringify(SEARCH_GROUP_ATTR)};
const SEARCH_GROUP_EMPTY_ATTR = ${JSON.stringify(SEARCH_GROUP_EMPTY_ATTR)};
const SEARCH_COUNT_ATTR = ${JSON.stringify(SEARCH_COUNT_ATTR)};
${focusable.toString()}
${filterIndex.toString()}
${filterGroups.toString()}
${wireSearch.toString()}
wireSearch(document.getElementById("site-search"));
</script>`;
    const filterScript = script.replace("<script>", "<script>\n");
    return {
        searchFirst: `<!doctype html><html><head>${head}</head><body>${search}${body}${searchScript}${filterScript}</body></html>`,
        filterFirst: `<!doctype html><html><head>${head}</head><body>${search}${body}${filterScript}${searchScript}</body></html>`,
        plain: `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
        wired: `<!doctype html><html><head>${head}</head><body>${body}${script}</body></html>`,
        rules: Object.fromEntries(state.values.map((value) => [value, filterRule(state.id, value)])),
    };
}

writeFileSync(join(here, "filter-input-fixture.generated.json"), JSON.stringify(await render()));
