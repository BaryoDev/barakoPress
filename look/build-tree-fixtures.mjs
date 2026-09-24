#!/usr/bin/env node
// Renders the tree screens (#130) through the real compiled package (dist, built by npm run
// build:package first) and writes each shape as one self-contained HTML file for
// tree.component.pw.ts to load with page.setContent. Run as plain Node under the next stub loader,
// the same way build-viewport-fixtures.mjs renders its pages.
//
//   tree-default   every part with no variant and no token: what a site that sets nothing draws.
//   tree-tokened   the same markup under a stylesheet naming a tree token for each kind of value,
//                  so the test can read back that each one reached its part in a real browser.
//   tree-designed  every variant at once, with the tokens barakocms.com's docs are drawn with, and
//                  the in-page index wired to the same filter the search box's client code runs.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineConfig } from "../dist/config.js";
import { ItemView } from "../dist/screens/collection.js";
import { filterIndex, SEARCH_EMPTY_ATTR, SEARCH_INDEX_ATTR, SEARCH_TEXT_ATTR } from "../dist/blocks/search-keys.js";

const here = dirname(fileURLToPath(import.meta.url));

// A token for each kind of value a tree token carries: a colour, a gap, a radius, a size, a weight.
export const TOKENED = {
    "tree-link-current-bg": "rgb(18, 52, 86)",
    "tree-link-current-ink": "rgb(250, 240, 230)",
    "tree-section-gap": "37px",
    "tree-link-radius": "3px",
    "tree-link-size": "19px",
    "tree-link-current-weight": "800",
    "tree-tab-current-bg": "rgb(10, 120, 30)",
    "tree-pager-radius": "21px",
};

// barakocms.com's docs, read off theme/barakocms/docs.tsx: what differs there from the engine's own values.
export const DESIGNED = {
    "tree-sidebar-width": "280px",
    "tree-sidebar-pad-x": "24px",
    "tree-aside-gap": "26px",
    "tree-section-gap": "24px",
    "tree-label-gap": "9px",
    "tree-label-size": "10.5px",
    "tree-link-gap": "1px",
    "tree-link-pad-y": "7px",
    "tree-link-pad-x": "12px",
    "tree-link-radius": "9px",
    "tree-link-size": "13.5px",
    "tree-link-leading": "1.5",
    "tree-link-weight": "500",
    "tree-link-current-weight": "700",
    "tree-note-size": "12px",
    "tree-note-weight": "500",
    "tree-body-pad-x": "56px",
    "tree-min-height": "1000px",
    "tree-rail-width": "250px",
    "tree-rail-pad-x": "24px",
    "tree-rail-label-gap": "14px",
    "tree-rail-link-size": "13px",
    "tree-rail-link-weight": "500",
    "tree-pager-top": "44px",
    "tree-pager-pad-y": "18px",
    "tree-pager-pad-x": "20px",
    "tree-pager-radius": "13px",
    "tree-pager-label-size": "11px",
    "tree-pager-title-gap": "6px",
    "tree-pager-title-weight": "700",
};

const BODY = [
    "What a manual page says first.",
    "## Install the package",
    "Run the install.",
    "## Configure the site",
    "Name the collection.",
    "## Deploy",
    "Ship it.",
].join("\n\n");

function config(tree = {}) {
    return defineConfig({
        site: { name: "Tree test", url: "https://tree.example" },
        collections: {
            docs: {
                type: "doc",
                route: "/docs",
                label: "Docs",
                fields: { title: "Title" },
                tree: {
                    section: "Section",
                    product: "Product",
                    searchPath: "/docs",
                    products: [
                        { key: "cms", label: "barakoCMS", href: "/docs" },
                        { key: "press", label: "barakoPress", href: "/docs/press" },
                        { key: "vm", label: "BaryoVM", href: "https://github.com/BaryoDev/BaryoVM", note: "on GitHub" },
                    ],
                    ...tree,
                },
            },
        },
    });
}

const item = (slug, title, body = "") => ({ id: slug, slug, title, collection: "docs", body, product: "cms" });
const node = (slug, title, body = "", children = []) => ({ item: item(slug, title, body), href: `/docs/${slug}`, children });

function tree() {
    const sections = [
        { name: "Getting started", nodes: [node("quickstart", "Quickstart", BODY), node("install", "Install and run", "## Requirements\n\nDocker.")] },
        { name: "Reference", nodes: [node("delivery", "Public delivery API", "## Paging\n\nA page at a time.", [node("filters", "Filters")]), node("webhooks", "Webhooks")] },
    ];
    const order = [item("quickstart", "Quickstart"), item("install", "Install and run"), item("delivery", "Public delivery API"), item("filters", "Filters"), item("webhooks", "Webhooks")];
    return { sections, order, truncated: false };
}

function page(cfg, current, css = "", script = "") {
    const t = cfg.theme;
    const body = renderToStaticMarkup(
        h("div", { style: { background: t.colors.pageBg, color: t.colors.ink, fontFamily: t.fonts.body } }, h(ItemView, { config: cfg, item: current, tree: tree() })),
    );
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body style="margin:0">${body}${script}</body></html>`;
}

const rootVars = (tokens) => `:root{${Object.entries(tokens).map(([k, v]) => `--t-${k}:${v}`).join(";")}}`;

// The filter the search box's client component runs, lifted out of the compiled package so this
// page, which has no React to hydrate, runs the same code on each keystroke.
const filterScript = `<script>
const SEARCH_INDEX_ATTR = ${JSON.stringify(SEARCH_INDEX_ATTR)};
const SEARCH_TEXT_ATTR = ${JSON.stringify(SEARCH_TEXT_ATTR)};
const SEARCH_EMPTY_ATTR = ${JSON.stringify(SEARCH_EMPTY_ATTR)};
${filterIndex.toString()}
const box = document.querySelector('input[type="search"]');
box.addEventListener("input", () => filterIndex(document.querySelector("[" + SEARCH_INDEX_ATTR + "]"), box.value));
</script>`;

const reading = item("delivery", "Public delivery API", "## Paging\n\nA page at a time.");
writeFileSync(join(here, "tree-default.generated.html"), page(config(), reading));
writeFileSync(join(here, "tree-tokened.generated.html"), page(config(), reading, rootVars(TOKENED)));
writeFileSync(
    join(here, "tree-designed.generated.html"),
    page(
        config({ variant: { switcher: "list", sidebar: "boxed", rail: true, pager: "halves" }, searchIndex: true }),
        item("quickstart", "Quickstart", BODY),
        rootVars(DESIGNED),
        filterScript,
    ),
);
