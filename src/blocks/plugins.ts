import { checkDefinition, type BlockDefinition, type BlockRegistry, type ResolvedBlock } from "./schema.js";

/*
 * Plugin packages (barakoPress #25).
 *
 * A plugin is an npm package whose default export is `definePlugin(...)`: a name and the blocks it
 * adds. It reaches a deployment through a derived image, because blocks are registered when the Next
 * build runs and a package cannot be added to a built image. One derived image carries every plugin
 * the deployment installs, and each tenant turns on the ones it uses with its `Plugins` setting.
 *
 * The name on a definition is what `registryFor` reads to leave a block out for a tenant that has not
 * enabled its plugin. Once it is left out, the tenant's pages cannot render it, `/api/blocks` does not
 * offer it, and a preset whose body holds it goes with it. That is the whole of the per-tenant
 * boundary, and it is a boundary on what renders, not on what runs: every plugin's module is loaded
 * in the container for every tenant it serves. Tenants that must not share plugin code belong in
 * separate deployments.
 *
 * A plugin block gets what any block gets, its props, its rendered slots and the theme. It is never
 * handed the config, the CMS address or a token: the blocks that read the site are rebound by identity
 * in `boundToSite`, and a plugin's definitions are never among them.
 */

export interface PressPlugin {
    /** What a tenant writes in its `Plugins` setting. Lowercase letters, digits and dashes. */
    name: string;
    /** What an editor calls it. */
    label?: string;
    blocks: BlockDefinition[];
}

const PLUGIN_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export function isPluginName(value: unknown): value is string {
    return typeof value === "string" && PLUGIN_NAME.test(value);
}

/**
 * A plugin package's default export. Checks every block the way a site's own blocks are checked, so a
 * definition that could never render fails the derived image's build rather than some page later.
 */
export function definePlugin(plugin: PressPlugin): PressPlugin {
    if (!isPluginName(plugin.name)) {
        throw new Error(`plugin name "${plugin.name}" must be lowercase letters, digits and dashes, starting with a letter`);
    }
    const types = new Set<string>();
    for (const block of plugin.blocks) {
        checkDefinition(block);
        // A body is compiled from data by `compilePreset`. One handed over by a plugin would carry
        // definitions this registry never checked.
        if (block.preset) throw new Error(`plugin "${plugin.name}" block "${block.type}" brings its own preset body`);
        if (types.has(block.type)) throw new Error(`plugin "${plugin.name}" registers "${block.type}" twice`);
        types.add(block.type);
    }
    return plugin;
}

/** The definitions a registry holds for a plugin, tagged with its name. */
export function pluginBlocks(plugin: PressPlugin): BlockDefinition[] {
    return plugin.blocks.map((block) => ({ ...block, layer: block.layer ?? "block", plugin: plugin.name }));
}

/*
 * The registry without the blocks of plugins this tenant has not enabled, and without any preset whose
 * body draws one. The same map comes back when nothing is left out, so a deployment with no plugins
 * pays for one walk over its registry.
 */
export function withEnabledPlugins(registry: BlockRegistry, enabled: readonly string[]): BlockRegistry {
    const on = new Set(enabled);
    const refused = (definition: BlockDefinition): boolean =>
        (definition.plugin !== undefined && !on.has(definition.plugin)) || (definition.preset?.some(drawsRefused) ?? false);
    const drawsRefused = (block: ResolvedBlock): boolean =>
        refused(block.definition) || Object.values(block.slots).some((lists) => lists.some((list) => list.some(drawsRefused)));

    let out: Map<string, BlockDefinition> | undefined;
    for (const [type, definition] of registry) {
        if (!refused(definition)) continue;
        out ??= new Map(registry);
        out.delete(type);
    }
    return out ?? registry;
}
