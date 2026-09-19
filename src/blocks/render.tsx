import type { ReactNode } from "react";
import type { PressTheme } from "../theme.js";
import type { ResolvedBlock } from "./schema.js";

/** Renders resolved blocks in order. Resolve first with `resolveBlocks`; this trusts its input. */
export function BlockList({ blocks, theme }: { blocks: ResolvedBlock[]; theme: PressTheme }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.space.lg }}>
            {blocks.map((block, index) => {
                const Component = block.definition.component;
                const slots: Record<string, ReactNode[]> = {};
                for (const [name, lists] of Object.entries(block.slots)) {
                    slots[name] = lists.map((list, i) => (
                        <BlockList key={i} blocks={list} theme={theme} />
                    ));
                }
                return (
                    <div key={index} data-block={block.definition.type}>
                        <Component props={block.props} slots={slots} theme={theme} />
                    </div>
                );
            })}
        </div>
    );
}
