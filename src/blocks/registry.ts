import { pinnedTenant, type PressConfig } from "../config.js";
import { boundToSite, builtInBlocks, copiedDefinition } from "./built-in.js";
import { libraryPresets } from "./library.js";
import { definePlugin, pluginBlocks, withEnabledPlugins, type PressPlugin } from "./plugins.js";
import { withPresets, type BlockPreset } from "./presets.js";
import { checkDefinition, type BlockDefinition, type BlockField, type BlockRegistry, type ResolvedBlock } from "./schema.js";
import { TONES, toneNames } from "./tokens.js";

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
 *
 * The library of barakoPress #21 goes in first, in its own pass, so a tenant's own `hero` replaces
 * the shipped one rather than being refused as a name already taken, and so the two do not share
 * one block budget. It comes with the built-ins because its bodies are built from them: without
 * them every preset in it would compile to an empty arrangement.
 *
 * Plugin blocks go in beside the site's own and may take no name already taken, by a built-in, the
 * library, another plugin or the site. Replacing one would change that block for every tenant on the
 * image, including the ones that never enabled the plugin, which is the one thing enablement promises
 * not to do.
 */
export function createBlockRegistry(
    config: PressConfig,
    blocks: BlockDefinition[] = [],
    options: { builtIns?: boolean; presets?: readonly BlockPreset[]; plugins?: readonly PressPlugin[] } = {},
): BlockRegistry {
    let registry = new Map<string, BlockDefinition>();
    if (options.builtIns !== false) {
        for (const block of builtInBlocks(config)) registry.set(block.type, block);
        registry = new Map(withPresets(registry, libraryPresets()));
    }

    const own = new Set<string>();
    for (const block of blocks) {
        checkDefinition(block);
        if (own.has(block.type)) throw new Error(`block type "${block.type}" is registered twice`);
        own.add(block.type);
        registry.set(block.type, block);
    }

    const plugins = new Set<string>();
    for (const plugin of (options.plugins ?? []).map(definePlugin)) {
        if (plugins.has(plugin.name)) throw new Error(`plugin "${plugin.name}" is installed twice`);
        plugins.add(plugin.name);
        for (const block of pluginBlocks(plugin)) {
            const taken = registry.get(block.type);
            if (taken) {
                const by = taken.plugin ? `plugin "${taken.plugin}"` : own.has(block.type) ? "the site" : "the engine";
                throw new Error(`plugin "${plugin.name}" block "${block.type}" is already registered by ${by}`);
            }
            registry.set(block.type, block);
        }
    }
    // Lazily, because this runs at module scope in a site's press.config.ts: the name is resolved in
    // the warning that needs it, not here (barakoPress #51).
    const names = toneNames(config.theme);
    const all = withPresets(withToneNames(registry, names), options.presets ?? config.presets, () =>
        pinnedTenant(config),
    );
    return withToneNames(all, names);
}

/**
 * The registry a request renders with: the site's, plus the tenant's own presets, with the blocks
 * that read the site bound to the config this request resolved.
 *
 * Built once per request and not once per process, because on a request-time site the presets are
 * the tenant's data and two tenants share the container. It is a copy of a small map when there is
 * something to change and the same map when there is not.
 *
 * Blocks of a plugin the tenant has not enabled are left out here, which is what keeps them off its
 * pages and out of its editor (#25).
 *
 * `holding` is passed down rather than asked for: a block that asked the request whether the site
 * is holding would read a cookie, and the page holding that block would stop being cacheable
 * (barakoPress #55). The caller already knows, because it decided which document to render.
 */
export function registryFor(
    config: PressConfig,
    registry: BlockRegistry,
    options: { holding?: boolean } = {},
): BlockRegistry {
    // First, so a tenant preset is compiled without the blocks this tenant has not enabled.
    const enabled = withEnabledPlugins(registry, config.plugins);
    const bound = boundToSite(enabled, config, options.holding === true);
    const names = toneNames(config.theme);
    const all = withPresets(withToneNames(bound, names), config.presets, () => pinnedTenant(config));
    return withToneNames(all, names);
}

/*
 * The site's own tones, offered by every tone field (#125).
 *
 * A tone field is a select whose options hold all six built-in tones, which is how every primitive
 * and every shipped preset declares one. A field that only shares its name, like the `Ink` select
 * on `text`, is left alone. A select checks its value against its own options, so this is what lets
 * a block store `tone: "cms"` at all, and it is also what the schema publishes.
 *
 * A preset's body is resolved against the definitions it is compiled with, and its props are checked
 * against those again when it expands. So the registry is widened before a preset is compiled, which
 * lets a body name a site tone outright, and again after, which carries the bodies of presets
 * compiled earlier, and a preset's own tone fields, over to the widened copies. Nothing is copied when every tone field already offers every name, so a site with no tones
 * of its own keeps the registry it had.
 */
function isToneField(field: BlockField): boolean {
    return field.kind === "select" && TONES.every((tone) => field.options?.includes(tone) === true);
}

export function withToneNames(registry: BlockRegistry, names: readonly string[]): BlockRegistry {
    if (names.length === 0) return registry;
    const copies = new Map<BlockDefinition, BlockDefinition>();

    const widenField = (field: BlockField): BlockField => {
        if (!isToneField(field)) return field;
        const missing = names.filter((name) => !field.options?.includes(name));
        return missing.length === 0 ? field : { ...field, options: [...(field.options ?? []), ...missing] };
    };

    const widenBlock = (block: ResolvedBlock): ResolvedBlock => {
        const definition = widen(block.definition);
        let changed = definition !== block.definition;
        const slots: Record<string, ResolvedBlock[][]> = {};
        for (const [name, lists] of Object.entries(block.slots)) {
            slots[name] = lists.map((list) =>
                list.map((inner) => {
                    const next = widenBlock(inner);
                    if (next !== inner) changed = true;
                    return next;
                }),
            );
        }
        return changed ? { ...block, definition, slots } : block;
    };

    const widen = (definition: BlockDefinition): BlockDefinition => {
        const done = copies.get(definition);
        if (done) return done;
        const before = definition.fields as BlockField[];
        const fields = before.map(widenField);
        const body = definition.preset?.map(widenBlock);
        const changed =
            fields.some((field, i) => field !== before[i]) ||
            (body !== undefined && body.some((block, i) => block !== definition.preset?.[i]));
        const out = changed
            ? copiedDefinition(definition, { ...definition, fields, ...(body ? { preset: body } : {}) } as BlockDefinition)
            : definition;
        copies.set(definition, out);
        return out;
    };

    let out: Map<string, BlockDefinition> | undefined;
    for (const [type, definition] of registry) {
        const next = widen(definition);
        if (next === definition) continue;
        out ??= new Map(registry);
        out.set(type, next);
    }
    return out ?? registry;
}
