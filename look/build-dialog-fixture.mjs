#!/usr/bin/env node
// Renders a repeat of dialog blocks through the real compiled package (dist, built by npm run
// build:package first), with the CMS read answered here, and writes the page twice: with no script,
// and with the dialog's client code on it. dialog.component.pw.ts loads both into a real browser.
//
// The client code is the compiled wireDialog, pasted in by toString because the page has no React to
// hydrate. Everything it reaches has to be pasted too: the attribute names below. A helper added to
// dialog-keys.tsx outside wireDialog, or one more attribute constant it reads, has to be added to
// this list, or the page throws and the look job fails with it.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { defineConfig } from "../dist/config.js";
import { bindBlocks } from "../dist/blocks/bind.js";
import { DIALOG_ATTR, DIALOG_CLOSE_ATTR, DIALOG_OPEN_ATTR, DIALOG_PANEL_ATTR } from "../dist/blocks/dialog-attrs.js";
import { wireDialog } from "../dist/blocks/dialog-keys.js";
import { BlockList } from "../dist/blocks/render.js";
import { createBlockRegistry } from "../dist/blocks/registry.js";
import { resolveBlocks } from "../dist/blocks/schema.js";
import { themeVariablesCss, VARIANT_ATTRIBUTE } from "../dist/theme.js";

const here = dirname(fileURLToPath(import.meta.url));

export const ROWS = [
    { title: "Auth", summary: "Sign in and tokens" },
    { title: "Files", summary: "Uploads and blobs" },
];

globalThis.fetch = async () =>
    Response.json({
        items: ROWS.map((row, i) => ({ id: `p${i}`, slug: `p${i}`, data: { Name: row.title, Summary: row.summary } })),
        page: 1,
        pageSize: 50,
        totalItems: ROWS.length,
        totalPages: 1,
        hasNextPage: false,
    });

async function render() {
    const config = defineConfig({
        site: { name: "Dialog test", url: "https://dialog.example" },
        cmsUrl: "http://cms.test",
        theme: { variants: { night: { ink: "#EEF0FF", surface: "#14162B", hairline: "#3A3D5C" } } },
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
                        {
                            type: "repeat",
                            props: {
                                content: [
                                    [
                                        { type: "text", props: { value: "card {{item.Title}}" } },
                                        {
                                            type: "dialog",
                                            props: {
                                                trigger: "Open {{item.Title}}",
                                                content: [
                                                    [
                                                        { type: "text", props: { value: "about {{item.Summary}}" } },
                                                        { type: "link", props: { label: "More on {{item.Title}}", href: "https://example.test/more" } },
                                                    ],
                                                ],
                                            },
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
    const body = renderToStaticMarkup(createElement(BlockList, { blocks: bound, theme: config.theme }));
    const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font-family:sans-serif}</style>';
    const script = `<script>
const DIALOG_ATTR = ${JSON.stringify(DIALOG_ATTR)};
const DIALOG_CLOSE_ATTR = ${JSON.stringify(DIALOG_CLOSE_ATTR)};
const DIALOG_OPEN_ATTR = ${JSON.stringify(DIALOG_OPEN_ATTR)};
const DIALOG_PANEL_ATTR = ${JSON.stringify(DIALOG_PANEL_ATTR)};
${wireDialog.toString()}
for (const root of document.querySelectorAll("[" + DIALOG_ATTR + "]")) wireDialog(root);
</script>`;
    // The page's own controls either side of the dialogs, so a focus trap has something to leak to.
    const around = (inner) => `<a id="before" href="#before">before</a>${inner}<a id="after" href="#after">after</a>`;
    // The same page under a theme variant, which a site switches with an attribute on the root.
    const variant = `<!doctype html><html ${VARIANT_ATTRIBUTE}="night"><head>${head}<style>${themeVariablesCss(config.theme)}</style></head><body>${around(body)}${script}</body></html>`;
    return {
        variant,
        plain: `<!doctype html><html><head>${head}</head><body>${around(body)}</body></html>`,
        wired: `<!doctype html><html><head>${head}</head><body>${around(body)}${script}</body></html>`,
    };
}

writeFileSync(join(here, "dialog-fixture.generated.json"), JSON.stringify(await render()));
