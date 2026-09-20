import type { PressConfig } from "../config.js";
import { collectionOf, searchCollection } from "../collections.js";
import { collectionTree } from "../tree.js";
import { SearchBox, TreeSidebar, TreeSwitcher } from "../screens/tree.js";
import { boundToConfig } from "./built-in.js";
import { defineBlock, type BlockDefinition } from "./schema.js";

/*
 * The documentation blocks (#23): a sidebar of a collection's tree, a product switcher, and a search
 * box over the same collection.
 *
 * Each draws the component the item page draws, so a landing page and a manual page show the same
 * sidebar with one implementation behind them. The names are `docsSidebar` and `docsSwitcher` because
 * that is what an editor picking a block is looking for, and neither knows what a doc is: both take a
 * collection key, and any collection with a `tree` answers.
 *
 * All three read the CMS, so they are built for the config a request resolved rather than for the one
 * the registry was made from, the same as the collection block.
 */

/** The most rows a search block lists. The API caps its own side at fifty. */
const MAX_SEARCH_ITEMS = 20;

type SidebarProps = { collection: string; product?: string; current?: string };

function docsSidebar(config: PressConfig, holding: boolean): BlockDefinition {
    const definition = defineBlock<SidebarProps>({
        type: "docsSidebar",
        label: "Documentation sidebar",
        layer: "block",
        fields: [
            collectionField(config),
            { name: "product", kind: "text", label: "Only this product" },
            { name: "current", kind: "text", label: "The page being read" },
        ],
        component: async ({ props }) => {
            // A holding page lists nothing from the site behind it, the same as the collection block.
            if (holding) return null;
            const tree = await collectionTree(config, props.collection, { product: props.product });
            if (tree.sections.length === 0) return null;
            return <TreeSidebar config={config} tree={tree} current={props.current} />;
        },
    });
    return boundToConfig(definition, docsSidebar);
}

type SwitcherProps = { collection: string; current?: string };

function docsSwitcher(config: PressConfig, holding: boolean): BlockDefinition {
    const definition = defineBlock<SwitcherProps>({
        type: "docsSwitcher",
        label: "Product switcher",
        layer: "block",
        fields: [collectionField(config), { name: "current", kind: "text", label: "The product being read" }],
        component: ({ props }) =>
            holding ? null : <TreeSwitcher config={config} collection={props.collection} current={props.current} />,
    });
    return boundToConfig(definition, docsSwitcher);
}

type SearchProps = { collection: string; query?: string; limit?: number };

function search(config: PressConfig, holding: boolean): BlockDefinition {
    const definition = defineBlock<SearchProps>({
        type: "search",
        label: "Search",
        layer: "block",
        fields: [
            collectionField(config),
            // Bindable, and that is how it is meant to be filled: `{{query.q}}` on a page whose route
            // file passes the query. Empty, the box renders and no search runs.
            { name: "query", kind: "text", label: "What was searched for" },
            { name: "limit", kind: "number", label: "How many results", min: 1, max: MAX_SEARCH_ITEMS },
        ],
        component: async ({ props }) => {
            if (holding) return null;
            const col = collectionOf(config, props.collection);
            if (!col) return null;
            const typed = (props.query ?? "").trim();
            const route = col.route ?? "";
            const found = typed ? await searchCollection(config, props.collection, typed, props.limit ?? 8) : undefined;
            return (
                <SearchBox
                    config={config}
                    action={route || "/"}
                    param="q"
                    query={props.query}
                    id={`bp-search-block-${props.collection}`}
                    results={found?.map((item) => ({
                        title: item.title,
                        ...(route && item.slug ? { href: `${route}/${item.slug}` } : {}),
                        ...(item.summary ? { summary: item.summary } : {}),
                    }))}
                />
            );
        },
    });
    return boundToConfig(definition, search);
}

/*
 * A build-time site offers the collections it has, so an editor cannot pick one that renders nothing.
 * A request-time site takes any name instead: each tenant's collections come from its own settings,
 * the registry is built once for all of them, and a name the tenant does not have renders nothing.
 */
function collectionField(config: PressConfig) {
    return config.sites
        ? ({ name: "collection", kind: "text", label: "Collection", required: true } as const)
        : ({
              name: "collection",
              kind: "select",
              label: "Collection",
              required: true,
              options: Object.keys(config.collections),
          } as const);
}

export function treeBlocks(config: PressConfig): BlockDefinition[] {
    return [docsSidebar(config, false), docsSwitcher(config, false), search(config, false)];
}
