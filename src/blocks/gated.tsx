import { pinnedTenant, type PressConfig } from "../config.js";
import { withViewerToken } from "../delivery.js";
import { gateOutcome, getViewer, mintViewerToken } from "../viewer.js";
import type { BlockDefinition, ResolvedBlock } from "./schema.js";

/*
 * Gated blocks (barakoPress #7).
 *
 * A block with a `gate` draws for a signed-in viewer the gate admits, and for no one else. The
 * viewer is checked against the tenant this request is pinned to, the same check a gated page makes,
 * so a session cookie from another tenant's host admits nobody. The calls the block makes while it
 * renders carry a viewer token minted on the server; a block without a gate never gets one. The
 * token is held in this process only and is not in the output.
 */
function gated(config: PressConfig, definition: BlockDefinition): BlockDefinition {
    const gate = definition.gate!;
    return {
        ...definition,
        async component(args) {
            const viewer = await getViewer(config);
            if (gateOutcome(viewer, { roles: gate.roles }, pinnedTenant(config)) !== "allow" || !viewer) return gate.fallback ?? null;
            const token = await mintViewerToken(config, viewer);
            const draw = async () => definition.component(args);
            return token ? withViewerToken(token, draw) : draw();
        },
    };
}

/** The blocks with every gated definition swapped for the one that checks the viewer, slots included. */
export function withGates(config: PressConfig, blocks: ResolvedBlock[]): ResolvedBlock[] {
    return blocks.map((block) => {
        const slots: Record<string, ResolvedBlock[][]> = {};
        for (const [name, lists] of Object.entries(block.slots)) slots[name] = lists.map((list) => withGates(config, list));
        return { ...block, definition: block.definition.gate ? gated(config, block.definition) : block.definition, slots };
    });
}

/** The blocks with every gated block removed, slots included. For output shared by every visitor. */
export function withoutGated(blocks: ResolvedBlock[]): ResolvedBlock[] {
    return blocks
        .filter((block) => !block.definition.gate)
        .map((block) => {
            const slots: Record<string, ResolvedBlock[][]> = {};
            for (const [name, lists] of Object.entries(block.slots)) slots[name] = lists.map(withoutGated);
            return { ...block, slots };
        });
}
