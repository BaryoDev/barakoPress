import type { CSSProperties, ReactNode } from "react";
import { recipeLook } from "../recipes.js";
import type { PressTheme } from "../theme.js";
import { filterAttrs } from "./filter.js";
import type { ResolvedBlock } from "./schema.js";

/*
 * A list of blocks is a column with a gap between the entries, unless the layout primitive holding
 * it says otherwise. `flow` sets `--bp-list` to `contents`, which takes this wrapper out of the box
 * tree so each block in the list becomes a cell of the flow rather than a row of this column.
 *
 * A custom property inherits, so each block resets it for whatever it holds: without the reset, a
 * list nested two levels under a flow would be transparent too, and its blocks would land in a grid
 * they have nothing to do with.
 */
const LIST_DISPLAY = "var(--bp-list, flex)";
const RESET_LIST: CSSProperties = { "--bp-list": "flex" } as CSSProperties;

/*
 * The gap is the theme's unless a stylesheet above the list sets `--bp-gap`. Unlike `--bp-list` it
 * is never reset, so a site theme that sets it once on its layout reaches every nesting level. An
 * inline `gap` cannot be overridden from a stylesheet, which is why this is a property at all.
 */
const listGap = (theme: PressTheme) => `var(--bp-gap, ${theme.space.lg})`;

/*
 * A wrapper taken out of the box tree, for a block that has to be the column's own child.
 *
 * `position: sticky` moves inside its containing block, and a wrapper is exactly as tall as
 * what it holds, so a sticky band wrapped like everything else has no room and scrolls away
 * with the page. `display: contents` leaves the custom property inheriting and the element
 * itself out of the layout, so the page column is the containing block.
 */
const TRANSPARENT: CSSProperties = { "--bp-list": "flex", display: "contents" } as CSSProperties;

/*
 * A block wearing a recipe is its own cell. The recipe is the design of that element, and a design
 * places its elements directly in their row or grid: a lede that takes `flex: 1 1 420px` beside a
 * claim, a card that is a grid item. With the wrapper in the box tree, those are the wrapper's to
 * take and it takes none of them. So under a recipe the wrapper is taken out of the layout the same
 * way a transparent block's is, and the recipe's element is the one its parent lays out. A recipe
 * the site does not have draws the block's own look, and the block keeps its wrapper with it.
 */
function wearsRecipe(block: ResolvedBlock, theme: PressTheme): boolean {
    const name = block.props.recipe;
    return typeof name === "string" && recipeLook(theme, name) !== undefined;
}

/** Renders resolved blocks in order. Resolve first with `resolveBlocks`; this trusts its input. */
export function BlockList({ blocks, theme }: { blocks: ResolvedBlock[]; theme: PressTheme }) {
    return (
        <div style={{ display: LIST_DISPLAY, flexDirection: "column", gap: listGap(theme) }}>
            {blocks.map((block, index) => {
                const Component = block.definition.component;
                const slots: Record<string, ReactNode[]> = {};
                for (const [name, lists] of Object.entries(block.slots)) {
                    slots[name] = lists.map((list, i) => (
                        <BlockList key={i} blocks={list} theme={theme} />
                    ));
                }
                return (
                    <div
                        key={index}
                        data-block={block.definition.type}
                        {...(block.filters?.length ? filterAttrs(block.filters) : {})}
                        style={block.definition.transparent || wearsRecipe(block, theme) ? TRANSPARENT : RESET_LIST}
                    >
                        <Component props={block.props} slots={slots} theme={theme} />
                    </div>
                );
            })}
        </div>
    );
}
