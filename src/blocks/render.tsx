import type { CSSProperties, ReactNode } from "react";
import type { PressTheme } from "../theme.js";
import { FILTER_ATTR, FILTER_VALUES_ATTR, filterTokens } from "./filter.js";
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
                        {...(block.filter
                            ? { [FILTER_ATTR]: block.filter.id, [FILTER_VALUES_ATTR]: filterTokens(block.filter.values) }
                            : {})}
                        style={block.definition.transparent ? TRANSPARENT : RESET_LIST}
                    >
                        <Component props={block.props} slots={slots} theme={theme} />
                    </div>
                );
            })}
        </div>
    );
}
