import type { ReactNode } from "react";
import { isSafeHref } from "../markdown.js";
import type { PressTheme } from "../theme.js";
import { BINDING_FORMATS, BINDING_SCOPES, hasBinding, readBindings } from "./bindings.js";

/*
 * The block model.
 *
 * A page holds an ordered list of `{ type, props }` in a json field. A site holds a registry that
 * maps each type name to a definition: the fields its props may carry, and the component that
 * renders them. The definition is the only source. The render side reads props through its
 * fields, and `blockSchema` publishes the same fields for an editor, so the two cannot disagree.
 * A render config and an editor config maintained side by side drift within a release, and the
 * failure is silent.
 *
 * The list is editor input and is treated as untrusted, the same as markdown. A block renders only
 * when its type is registered and every prop it declares passes its field. A component never sees
 * a prop its definition did not declare, and a url prop has already passed `isSafeHref`.
 */

export type FieldKind = "text" | "markdown" | "url" | "number" | "boolean" | "select" | "slots";

export interface BlockField {
    name: string;
    kind: FieldKind;
    /** What an editor calls it. */
    label?: string;
    required?: boolean;
    /** The allowed values of a `select`. */
    options?: string[];
    /** A `number` value's range, or how many lists a `slots` field holds. Inclusive. */
    min?: number;
    max?: number;
    /**
     * Whether the stored value may hold `{{scope.Field}}` placeholders. Every string field takes
     * them unless it says otherwise. A number or a boolean does not: a binding resolves to text,
     * and a number that arrives as text is a bug rather than a binding.
     *
     * Published in the block schema, so an editor knows which inputs get a binding picker.
     */
    bindable?: boolean;
}

const BINDABLE_BY_DEFAULT: ReadonlySet<FieldKind> = new Set<FieldKind>(["text", "markdown", "url", "select"]);

export function isBindable(field: BlockField): boolean {
    return field.bindable ?? BINDABLE_BY_DEFAULT.has(field.kind);
}

export type BlockProps = Record<string, unknown>;

/*
 * A field as a site writes it, checked against the component's props: the name must be one of
 * them, the kind must suit its type, and a prop the component treats as always present must be a
 * required field. Without this, `defineBlock<{ title: string }>` could declare only `heading` and
 * the component would read `props.title` as a string that the renderer never passes.
 */
type ValueKind<V> = [V] extends [boolean]
    ? "boolean"
    : [V] extends [number]
      ? "number"
      : [V] extends [string]
        ? "text" | "markdown" | "url" | "select"
        : Exclude<FieldKind, "slots">;

type Presence<P, K extends keyof P> = {} extends Pick<P, K> ? { required?: boolean } : { required: true };

type ValueField<P> = {
    [K in keyof P & string]: Omit<BlockField, "name" | "kind" | "required"> & {
        name: K;
        kind: ValueKind<NonNullable<P[K]>>;
    } & Presence<P, K>;
}[keyof P & string];

type SlotsField<S extends string> = Omit<BlockField, "name" | "kind"> & { name: S; kind: "slots" };

export type TypedBlockField<P extends BlockProps, S extends string> = ValueField<P> | SlotsField<S>;

export interface BlockComponentProps<P extends BlockProps = BlockProps, S extends string = string> {
    props: P;
    /**
     * Each `slots` field, rendered: one node per nested list. Rendered here rather than handed
     * over as data, so a client component can hold nested blocks without being given the registry.
     */
    slots: Record<S, ReactNode[]>;
    /*
     * The theme and not the whole config. A component may be a client component, and whatever it
     * is given is serialised into the page. The config carries the CMS address, which is never
     * rendered. A server block that needs the config closes over it, as the collection block does.
     */
    theme: PressTheme;
}

export interface BlockDefinition<P extends BlockProps = BlockProps, S extends string = string> {
    /** The name stored in the page's `type`. */
    type: string;
    label: string;
    fields: BlockField[] | TypedBlockField<P, S>[];
    /**
     * The layer this belongs to, published so an editor can group what it offers. `primitive` is a
     * part, `preset` a saved arrangement of parts, `data` a block that loads or chooses rather than
     * draws, and `block` the code blocks with behaviour of their own.
     */
    layer?: "primitive" | "preset" | "data" | "block";
    /**
     * A preset's body: the block list it stands for, expanded at render with `props` bound to this
     * block's own props. Set by `compilePreset`, never by hand.
     */
    preset?: ResolvedBlock[];
    /**
     * Shows something that depends on who is looking. Such a block is left out by `createPage`,
     * whose output is shared by every visitor, and rendered by `createViewerPage`, which is never
     * cached.
     */
    perViewer?: boolean;
    // Method syntax, so a definition typed for its own props still fits a registry of any props.
    component(args: BlockComponentProps<P, S>): ReactNode | Promise<ReactNode>;
}

export type BlockRegistry = ReadonlyMap<string, BlockDefinition>;

/**
 * `P` is the props the component reads and `S` the names of its `slots` fields. Both are checked
 * against `fields` here. The result is erased to the untyped definition a registry holds, which is
 * safe because `resolveBlocks` only ever hands a component the props those same fields accepted.
 */
export function defineBlock<P extends BlockProps = BlockProps, S extends string = never>(
    definition: BlockDefinition<P, S> & { fields: TypedBlockField<P, S>[] },
): BlockDefinition {
    return definition as unknown as BlockDefinition;
}

/*
 * Bounds on untrusted input, so a pasted list cannot make one render arbitrarily expensive.
 * MAX_BLOCKS is for the whole tree, not each list: per list, four levels of four columns would
 * still allow billions of entries.
 */
export const MAX_BLOCKS = 100;
export const MAX_DEPTH = 4;

/** Refuses a definition that could never render, at startup rather than on some page later. */
export function checkDefinition(definition: BlockDefinition): void {
    if (!definition.type) throw new Error("a block definition needs a type");
    const names = new Set<string>();
    for (const field of definition.fields as BlockField[]) {
        if (!field.name) throw new Error(`block "${definition.type}" has a field with no name`);
        if (names.has(field.name)) {
            throw new Error(`block "${definition.type}" declares "${field.name}" twice`);
        }
        names.add(field.name);
        if (field.kind === "select" && !field.options?.length) {
            throw new Error(`block "${definition.type}" field "${field.name}" is a select with no options`);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inRange(field: BlockField, n: number): boolean {
    return (field.min === undefined || n >= field.min) && (field.max === undefined || n <= field.max);
}

/*
 * A template stands in for what it will resolve to, with every placeholder replaced by the most
 * harmless value of its kind, so the field's own rule still gets a say before anything is bound.
 * "javascript:{{item.Url}}" fails `url` here, at save-shaped input, rather than depending on what
 * the binding happens to return. What it does return is checked again after substitution.
 */
function standIn(field: BlockField): string {
    if (field.kind === "url") return "/x";
    // Any of the options will do: what the binding resolves to is checked against them for real
    // once it has resolved.
    if (field.kind === "select") return field.options?.[0] ?? "x";
    return "x";
}

export function withoutBindings(field: BlockField, value: string): string {
    const filler = standIn(field);
    let out = value;
    for (const binding of readBindings(value)) out = out.split(binding.raw).join(filler);
    return out;
}

export function accepts(field: BlockField, value: unknown): boolean {
    if (typeof value === "string" && isBindable(field) && hasBinding(value)) {
        return acceptsValue(field, withoutBindings(field, value));
    }
    return acceptsValue(field, value);
}

function acceptsValue(field: BlockField, value: unknown): boolean {
    switch (field.kind) {
        case "text":
        case "markdown":
            return typeof value === "string";
        case "url":
            return typeof value === "string" && isSafeHref(value);
        case "boolean":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number" && Number.isFinite(value) && inRange(field, value);
        case "select":
            return typeof value === "string" && (field.options ?? []).includes(value);
        case "slots":
            return Array.isArray(value) && value.every(Array.isArray) && inRange(field, value.length);
    }
}

/*
 * Props through the block's fields, or null when the block must not render.
 *
 * A value that is present and wrong fails the whole block, even on an optional field. Dropping
 * just the value would render a call to action whose link was quietly removed, which is worse
 * than a missing block an editor can see is missing.
 */
export function readProps(fields: BlockField[], raw: unknown): BlockProps | null {
    if (!isRecord(raw)) return null;
    const props: BlockProps = {};
    for (const field of fields) {
        const value = raw[field.name];
        if (value === undefined || value === null || value === "") {
            if (field.required) return null;
            continue;
        }
        if (!accepts(field, value)) return null;
        props[field.name] = value;
    }
    return props;
}

export interface ResolvedBlock {
    definition: BlockDefinition;
    props: BlockProps;
    /** Each `slots` field's lists, resolved. The raw lists are not left in `props`. */
    slots: Record<string, ResolvedBlock[][]>;
}

export interface ResolveOptions {
    /** Whether blocks marked `perViewer` may render. False wherever the output is shared. */
    perViewer: boolean;
}

export function resolveBlocks(raw: unknown, registry: BlockRegistry, options: ResolveOptions): ResolvedBlock[] {
    return resolveList(raw, registry, options, 0, { remaining: MAX_BLOCKS });
}

/*
 * Every entry looked at spends the shared budget, whether it renders or is dropped, because the
 * work is in looking. Once it is spent nothing further is read, at any depth.
 */
function resolveList(
    raw: unknown,
    registry: BlockRegistry,
    options: ResolveOptions,
    depth: number,
    budget: { remaining: number },
): ResolvedBlock[] {
    if (!Array.isArray(raw) || depth >= MAX_DEPTH) return [];

    const resolved: ResolvedBlock[] = [];
    for (const item of raw) {
        if (budget.remaining <= 0) break;
        budget.remaining--;
        if (!isRecord(item) || typeof item.type !== "string") continue;
        const definition = registry.get(item.type);
        if (!definition) continue;
        if (definition.perViewer && !options.perViewer) continue;

        const fields = definition.fields as BlockField[];
        const props = readProps(fields, item.props ?? {});
        if (!props) continue;

        const slots: Record<string, ResolvedBlock[][]> = {};
        for (const field of fields) {
            if (field.kind !== "slots") continue;
            const lists = (props[field.name] as unknown[][] | undefined) ?? [];
            slots[field.name] = [];
            for (const list of lists) {
                if (budget.remaining <= 0) break;
                slots[field.name].push(resolveList(list, registry, options, depth + 1, budget));
            }
            delete props[field.name];
        }

        resolved.push({ definition, props, slots });
    }
    return resolved;
}

export interface BlockSchema {
    version: 2;
    /** The scopes and formats a binding may name, so an editor offers exactly what renders. */
    bindings: { scopes: string[]; formats: string[] };
    blocks: {
        type: string;
        label: string;
        layer: "primitive" | "preset" | "data" | "block";
        perViewer: boolean;
        fields: (BlockField & { bindable: boolean })[];
    }[];
}

/** What this site can render, as data an editor can build a form from. */
export function blockSchema(registry: BlockRegistry): BlockSchema {
    return {
        version: 2,
        bindings: { scopes: [...BINDING_SCOPES], formats: [...BINDING_FORMATS] },
        blocks: [...registry.values()].map((d) => ({
            type: d.type,
            label: d.label,
            layer: d.layer ?? "block",
            perViewer: d.perViewer === true,
            // Options copied too: the registry validates against its own array, and this result is
            // handed to callers. `bindable` is resolved rather than passed through, so an editor
            // reads one answer instead of reimplementing the default.
            fields: (d.fields as BlockField[]).map((f) => ({
                ...f,
                options: f.options ? [...f.options] : undefined,
                bindable: isBindable(f),
            })),
        })),
    };
}
