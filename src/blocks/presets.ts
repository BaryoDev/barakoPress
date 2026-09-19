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

/*
 * Saying a preset was dropped, once.
 *
 * A request-time site builds its registry on every request, so warning where the drop happens would
 * put one line per request in the log for a preset somebody has to rename once. The same message is
 * said once and then remembered, the way delivery.ts remembers a failed read, and the set is
 * bounded because a preset name is typed by somebody. Full, it is emptied rather than trimmed, so
 * the messages come back rather than stopping for the life of the process.
 */
const SAID_MAX = 200;
const said = new Set<string>();

function sayOnce(message: string): void {
    if (said.has(message)) return;
    if (said.size >= SAID_MAX) said.clear();
    said.add(message);
    console.warn(message);
}

/** For tests: say every message again. */
export function forgetPresetWarnings(): void {
    said.clear();
}

const forTenant = (tenant: string | undefined) => (tenant ? ` for tenant "${tenant}"` : "");

/**
 * The most drops one reading of a tenant's settings spells out, before it says how many are left.
 *
 * A settings blob typed wrong holds up to `MAX_PRESETS` broken entries, and one line each would
 * fill the log and then the set above with a single bad paste.
 */
const MAX_SAID_DROPS = 5;

/*
 * A dropped entry as it appears in a message.
 *
 * The type it claims is what a person recognises, so it is shown, and the index is there because a
 * broken entry may have no usable name at all. It came out of a settings field, so it is cut to a
 * length and stripped of anything outside printable ASCII: a stored newline in a log line reads as
 * a second log line.
 */
function entryName(raw: unknown, index: number): string {
    const type = isRecord(raw) && typeof raw.type === "string" ? raw.type : "";
    const safe = type.replace(/[^\x20-\x7E]/g, "").replace(/"/g, "").slice(0, 40);
    return safe ? `"${safe}" (entry ${index + 1})` : `entry ${index + 1}`;
}

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
export function presetsFrom(value: unknown, tenant?: string): BlockPreset[] {
    if (!Array.isArray(value)) return [];
    const out: BlockPreset[] = [];
    const seen = new Set<string>();
    // Each reason is its own line, because a type name that is not a name, a name used twice and a
    // field list that is not a list are three different things to go and correct. One catchall
    // would tell a person only that something was wrong.
    const dropped: string[] = [];

    value.slice(0, MAX_PRESETS).forEach((raw, index) => {
        const where = entryName(raw, index);
        if (!isRecord(raw)) {
            dropped.push(`${where} is not a preset`);
            return;
        }
        const type = typeof raw.type === "string" ? raw.type : "";
        if (!NAME.test(type)) {
            dropped.push(`${where} has no type, or one that is not a name`);
            return;
        }
        if (seen.has(type)) {
            dropped.push(`${where} uses a type an earlier preset already uses`);
            return;
        }
        const read = fieldsFrom(raw.fields);
        if (read === null) {
            dropped.push(`${where} has fields that are not a list`);
            return;
        }
        if (read.skipped > 0) {
            // The preset is kept: it renders, and its other props work. What it is short of is the
            // props somebody thinks it exposes, so a binding to one renders its fallback forever.
            dropped.push(
                `${where} keeps ${read.fields.length} of its fields, because ${read.skipped} ` +
                    `${read.skipped === 1 ? "is not a field" : "are not fields"}`,
            );
        }
        seen.add(type);
        out.push({
            type,
            label: typeof raw.label === "string" && raw.label ? raw.label : type,
            fields: read.fields,
            blocks: raw.blocks,
        });
    });

    for (const why of dropped.slice(0, MAX_SAID_DROPS)) sayOnce(`blocks: ${why}${forTenant(tenant)}`);
    if (dropped.length > MAX_SAID_DROPS) {
        sayOnce(
            `blocks: ${dropped.length - MAX_SAID_DROPS} more preset settings${forTenant(tenant)} ` +
                `are wrong in the same way, and are not spelled out`,
        );
    }
    return out;
}

interface ReadFields {
    fields: BlockField[];
    /** Entries in the list that are not fields. The preset keeps the rest. */
    skipped: number;
}

/** Null for a field list that is not one, so the preset is dropped rather than exposing no props. */
function fieldsFrom(value: unknown): ReadFields | null {
    if (value === undefined) return { fields: [], skipped: 0 };
    if (!Array.isArray(value)) return null;
    const fields: BlockField[] = [];
    let skipped = 0;
    for (const raw of value.slice(0, 30)) {
        if (!isRecord(raw)) {
            skipped++;
            continue;
        }
        const name = typeof raw.name === "string" ? raw.name : "";
        const kind = typeof raw.kind === "string" ? raw.kind : "";
        if (!NAME.test(name) || !FIELD_KINDS.includes(kind)) {
            skipped++;
            continue;
        }
        const options = Array.isArray(raw.options)
            ? raw.options.filter((o): o is string => typeof o === "string").slice(0, 40)
            : undefined;
        if (kind === "select" && (!options || options.length === 0)) {
            skipped++;
            continue;
        }
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
    return { fields, skipped };
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
 * The most blocks a tenant's presets may hold between them. A request-time site compiles them per
 * request, so the bodies are bounded together and not only one at a time: sixty presets of a
 * hundred blocks each is work nobody asked for on every page.
 */
export const MAX_PRESET_BLOCKS = MAX_BLOCKS * 4;

/**
 * The registry with these presets added. Same map when there are none, so the common path allocates
 * nothing. A preset never replaces a code block: a tenant naming one `collection` would swap out
 * behaviour the site depends on, and a name collision is a mistake worth seeing rather than a
 * feature. Presets resolve against a registry without them, which is what stops one nesting another.
 *
 * A preset that is not used says so. A setting that quietly does nothing is worse than one that is
 * missing, because it reads as done: somebody naming a preset `collection` in barakoBrew would
 * otherwise get a block that never appears anywhere, with nothing to look at. The two reasons are
 * separate messages, because renaming the preset fixes one and only shortening them fixes the other.
 */
export function withPresets(
    registry: BlockRegistry,
    presets: readonly BlockPreset[],
    tenant?: string,
): BlockRegistry {
    if (presets.length === 0) return registry;
    const out = new Map(registry);
    let budget = MAX_PRESET_BLOCKS;
    let dropped = 0;

    for (const preset of presets) {
        const taken = out.get(preset.type);
        if (taken) {
            sayOnce(
                `blocks: the preset "${preset.type}"${forTenant(tenant)} is not used, because the ` +
                    `${taken.layer ?? "block"} "${taken.label}" is already registered under that name`,
            );
            continue;
        }
        if (budget <= 0) {
            dropped++;
            continue;
        }
        const compiled = compilePreset(preset, registry);
        budget -= countBlocks(compiled.preset ?? []);
        out.set(preset.type, compiled);
    }

    if (dropped > 0) {
        sayOnce(
            `blocks: ${dropped} preset${dropped === 1 ? "" : "s"}${forTenant(tenant)} ` +
                `${dropped === 1 ? "is" : "are"} not used, because the ones before ` +
                `${dropped === 1 ? "it" : "them"} already hold ${MAX_PRESET_BLOCKS} blocks between them`,
        );
    }
    return out;
}

function countBlocks(blocks: ResolvedBlock[]): number {
    return blocks.reduce(
        (n, b) => n + 1 + Object.values(b.slots).reduce((m, lists) => m + countBlocks(lists.flat()), 0),
        0,
    );
}
