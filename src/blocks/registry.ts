import type { PressConfig } from "../config.js";
import { builtInBlocks } from "./built-in.js";
import { withPresets, type BlockPreset } from "./presets.js";
import { checkDefinition, type BlockDefinition, type BlockRegistry } from "./schema.js";

/*
 * A site's blocks: the built-ins plus its own, plus any presets.
 *
 * A consumer block with a built-in's type name replaces it, which is how a site keeps the stored
 * data and swaps the look. Two consumer blocks with one name is a mistake and throws, since which
 * one won would depend on the order of an array.
 *
 * Presets are added last and never replace a code block, because a preset is data a designer saves
 * and a code block is behaviour the site depends on. A request-time site's presets come from its
 * tenant's settings, so they are applied per request in `registryFor` rather than here.
 */
export function createBlockRegistry(
    config: PressConfig,
    blocks: BlockDefinition[] = [],
    options: { builtIns?: boolean; presets?: readonly BlockPreset[] } = {},
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
    return withPresets(registry, options.presets ?? config.presets);
}

/**
 * The registry a request renders with: the site's, plus the tenant's own presets.
 *
 * Built once per request and not once per process, because on a request-time site the presets are
 * the tenant's data and two tenants share the container. It is a copy of a small map when the
 * tenant has presets and the same map when it does not.
 */
export function registryFor(config: PressConfig, registry: BlockRegistry): BlockRegistry {
    return withPresets(registry, config.presets);
}
