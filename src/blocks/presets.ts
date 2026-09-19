import {
    MAX_BLOCKS,
    checkDefinition,
    resolveBlocks,
    type BlockDefinition,
    type BlockField,
    type BlockRegistry,
    type ResolvedBlock,
} from "./schema.js";

/*
 * Layer 3 of barakoPress #33: a preset is a named arrangement of primitives, stored as data.
 *
 * `hero`, `band` and `tiers` are not code. A preset names the props it exposes, holds a block list
 * built from the primitives, and binds its own props into that list through the `props` scope:
 *
 *     {
 *       type: "hero",
 *       label: "Hero",
 *       fields: [{ name: "heading", kind: "text", required: true }],
 *       blocks: [{ type: "section", props: { tone: "accent", content: [[
 *         { type: "text", props: { value: "{{props.heading}}", variant: "display" } }
 *       ]] } }]
 *     }
 *
 * So a designer saves a new named block in barakoBrew and every site on the published image can use
 * it, with no barakoPress release. That is the point of the layer, and it is what makes barakoCMS
 * D22 hold for blocks: the image is the same everywhere, the arrangement is the tenant's data.
 *
 * A preset body may use primitives, data blocks and code blocks, not other presets. One preset
 * standing for another is a graph an editor cannot see and a cycle nobody notices until a page
 * stops answering, and the gain over writing the parts out is small.
 */

export interface BlockPreset {
    /** The name stored in a page's `type`, for example "hero". */
    type: string;
    label: string;
    /** The props it exposes, read inside `blocks` as `{{props.<name>}}`. */
    fields: BlockField[];
    /** The arrangement, in the same shape a page stores: a list of `{ type, props }`. */
    blocks: unknown;
}

/** The most presets one tenant may define. A registry is walked on every page. */
export const MAX_PRESETS = 60;

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FIELD_KINDS = ["text", "markdown", "url", "number", "boolean", "select", "slots"];

/**
 * A preset as a tenant stores it, checked.
 *
 * Every value here was typed by somebody in barakoBrew and crossed a process boundary, so it is
 * read the way site settings are: anything that does not hold its shape is left out whole rather
 * than half applied. The blocks are not checked here; `compilePreset` does that against the
 * registry, which is the only thing that knows what this site can render.
 */
export function presetsFrom(value: unknown): BlockPreset[] {
    if (!Array.isArray(value)) return [];
    const out: BlockPreset[] = [];
    const seen = new Set<string>();
    for (const raw of value.slice(0, MAX_PRESETS)) {
        if (!isRecord(raw)) continue;
        const type = typeof raw.type === "string" ? raw.type : "";
        if (!NAME.test(type) || seen.has(type)) continue;
        const fields = fieldsFrom(raw.fields);
        if (fields === null) continue;
        seen.add(type);
        out.push({
            type,
            label: typeof raw.label === "string" && raw.label ? raw.label : type,
            fields,
            blocks: raw.blocks,
        });
    }
    return out;
}

/** Null for a field list that is not one, so the preset is dropped rather than exposing no props. */
function fieldsFrom(value: unknown): BlockField[] | null {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return null;
    const fields: BlockField[] = [];
    for (const raw of value.slice(0, 30)) {
        if (!isRecord(raw)) continue;
        const name = typeof raw.name === "string" ? raw.name : "";
        const kind = typeof raw.kind === "string" ? raw.kind : "";
        if (!NAME.test(name) || !FIELD_KINDS.includes(kind)) continue;
        const options = Array.isArray(raw.options)
            ? raw.options.filter((o): o is string => typeof o === "string").slice(0, 40)
            : undefined;
        if (kind === "select" && (!options || options.length === 0)) continue;
        fields.push({
            name,
            kind: kind as BlockField["kind"],
            label: typeof raw.label === "string" ? raw.label : undefined,
            required: raw.required === true,
            options,
            min: typeof raw.min === "number" ? raw.min : undefined,
            max: typeof raw.max === "number" ? raw.max : undefined,
            bindable: typeof raw.bindable === "boolean" ? raw.bindable : undefined,
        });
    }
    return fields;
}

/**
 * A preset as a block definition, with its body resolved once against the blocks this site has.
 *
 * Resolved here and not per render because the body is the same on every page that uses the preset,
 * and because a body that names a block this site does not register should be visibly empty at
 * startup rather than quietly short on every page.
 *
 * The component is never called: `bindBlocks` replaces a preset block with its expanded body before
 * anything renders. It is here so the definition is complete, and it renders whatever an editor put
 * in the preset's slots, which is the closest thing to right if a caller skips the binding pass.
 */
export function compilePreset(preset: BlockPreset, registry: BlockRegistry): BlockDefinition {
    const body = resolveBlocks(preset.blocks, registry, { perViewer: true });
    const definition: BlockDefinition = {
        type: preset.type,
        label: preset.label,
        layer: "preset",
        fields: preset.fields,
        preset: body,
        // A preset holding a per-viewer block is per-viewer itself. The body is resolved once at
        // startup, so the page-level check is the only one that can keep it out of a shared cache.
        perViewer: body.some((b) => b.definition.perViewer === true),
        component: ({ slots }) => Object.values(slots).flat(),
    };
    checkDefinition(definition);
    return definition;
}

/**
 * The registry with these presets added. Same map when there are none, so the common path allocates
 * nothing. A preset never replaces a code block: a tenant naming one `collection` would swap out
 * behaviour the site depends on, and a name collision is a mistake worth seeing rather than a
 * feature. Presets resolve against a registry without them, which is what stops one nesting another.
 */
export function withPresets(registry: BlockRegistry, presets: readonly BlockPreset[]): BlockRegistry {
    if (presets.length === 0) return registry;
    const out = new Map(registry);
    // A request-time site compiles its tenant's presets per request, so the bodies are bounded
    // together and not only one at a time. Sixty presets of a hundred blocks each is work nobody
    // asked for on every page.
    let budget = MAX_BLOCKS * 4;
    for (const preset of presets) {
        if (out.has(preset.type) || budget <= 0) continue;
        const compiled = compilePreset(preset, registry);
        budget -= countBlocks(compiled.preset ?? []);
        out.set(preset.type, compiled);
    }
    return out;
}

function countBlocks(blocks: ResolvedBlock[]): number {
    return blocks.reduce(
        (n, b) => n + 1 + Object.values(b.slots).reduce((m, lists) => m + countBlocks(lists.flat()), 0),
        0,
    );
}
