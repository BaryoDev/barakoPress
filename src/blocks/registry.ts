import type { PressConfig } from "../config.js";
import { builtInBlocks } from "./built-in.js";
import { checkDefinition, type BlockDefinition, type BlockRegistry } from "./schema.js";

/*
 * A site's blocks: the built-ins plus its own.
 *
 * A consumer block with a built-in's type name replaces it, which is how a site keeps the stored
 * data and swaps the look. Two consumer blocks with one name is a mistake and throws, since which
 * one won would depend on the order of an array.
 */
export function createBlockRegistry(
    config: PressConfig,
    blocks: BlockDefinition[] = [],
    options: { builtIns?: boolean } = {},
): BlockRegistry {
    const registry = new Map<string, BlockDefinition>();
    if (options.builtIns !== false) {
        for (const block of builtInBlocks(config)) registry.set(block.type, block);
    }

    const own = new Set<string>();
    for (const block of blocks) {
        checkDefinition(block);
        if (own.has(block.type)) throw new Error(`block type "${block.type}" is registered twice`);
        own.add(block.type);
        registry.set(block.type, block);
    }
    return registry;
}
