import type { ReactNode } from "react";
import { isSafeHref } from "../markdown.js";
import type { PressTheme } from "../theme.js";
import { BINDING_FORMATS, BINDING_SCOPES, hasBinding, readBindings, wholeBinding } from "./bindings.js";

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

export type FieldKind =
    | "text"
    | "markdown"
    | "url"
    | "number"
    | "boolean"
    | "select"
    | "slots"
    | "list"
    | "group";

/** What one entry of a `list` may be. */
export type ListItemKind = "text" | "url" | "number" | "group";

export const LIST_ITEM_KINDS: readonly ListItemKind[] = ["text", "url", "number", "group"];

/** One entry of a `list`: a scalar with its own range, or a group with its own fields. */
export interface ListItem {
    kind: ListItemKind;
    label?: string;
    /** A `number` item's range. Inclusive. */
    min?: number;
    max?: number;
    /** A `group` item's fields. */
    fields?: BlockField[];
    bindable?: boolean;
}

export interface BlockField {
    name: string;
    kind: FieldKind;
    /** What an editor calls it. */
    label?: string;
    required?: boolean;
    /** The allowed values of a `select`. */
    options?: string[];
    /**
     * A `number` value's range, or how many entries a `slots` or a `list` field holds. Inclusive.
     */
    min?: number;
    max?: number;
    /** What each entry of a `list` is. */
    item?: ListItem;
    /** A `group`'s own fields. */
    fields?: BlockField[];
    /**
     * Whether the stored value may hold `{{scope.Field}}` placeholders. Every string field takes
     * them unless it says otherwise. A number or a boolean does not: a binding resolves to text,
     * and a number that arrives as text is a bug rather than a binding.
     *
     * On a `list` or a `group` it means the whole value may be one placeholder, `{{item.Tags}}`,
     * which resolves to the array or the object it names rather than to text. The strings inside
     * one follow their own fields.
     *
     * Published in the block schema, so an editor knows which inputs get a binding picker.
     */
    bindable?: boolean;
}

const BINDABLE_BY_DEFAULT: ReadonlySet<FieldKind> = new Set<FieldKind>([
    "text",
    "markdown",
    "url",
    "select",
    "list",
    "group",
]);

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
        : [V] extends [readonly unknown[]]
          ? "list"
          : [V] extends [object]
            ? "group"
            : Exclude<FieldKind, "slots">;

type Presence<P, K extends keyof P> = {} extends Pick<P, K> ? { required?: boolean } : { required: true };

type ValueField<P> = {
    [K in keyof P & string]: Omit<BlockField, "name" | "kind" | "required"> & {
        name: K;
        // An untyped prop takes any kind. Checked before NonNullable, which turns unknown into {}.
        kind: unknown extends P[K] ? Exclude<FieldKind, "slots"> : ValueKind<NonNullable<P[K]>>;
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
    /**
     * Draws without the wrapper `BlockList` puts around every block, which is `display: contents`
     * on that wrapper rather than no element at all.
     *
     * One block needs it and the reason is narrow. A wrapper hugs its child, and a `position: sticky`
     * element can only move inside its own containing block, so a sticky band wrapped like every
     * other block has nowhere to move and scrolls away. Taking the wrapper out of the box tree makes
     * the page's own column the containing block, which is the whole page. Measured: wrapped, the
     * band's top goes from 0 to -400 after scrolling 400px; transparent, it stays at 0.
     */
    transparent?: boolean;
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
 * MAX_BLOCKS is for the whole tree, not each list: per list, a few levels of four columns would
 * still allow billions of entries. It is the bound that does the work, and it is why the depth can
 * be generous: however deep a page nests, only this many entries are ever read.
 *
 * It was a hundred, chosen when a page was a handful of blocks. A band from the library is not a
 * block, it is a preset that expands into eight or ten, and the binder spends the budget on every
 * one it walks through as well as on every one that comes out. The baryo.dev look fixture is eight
 * bands, and it ran out on the seventh: the sponsor band at the bottom of the page was simply not
 * there, with nothing said (#83). Four hundred is about thirty bands, which is a long marketing
 * page and still a bound. What it costs is bounded too: the reads a page may make are capped
 * separately at MAX_SOURCES, and a binding is capped at MAX_TEMPLATE, so this only buys more
 * substitution over short strings.
 *
 * The drop is still silent, which is the half this does not fix. A page that goes over its budget
 * loses its tail and renders as though that were the page.
 *
 * The depth is what a preset body needs rather than what a page needs. A card grid is a band, a
 * heading beside a source, a flow, a repeat, a card and the stack inside it before a single word of
 * content, which is seven lists deep and used to render as nothing below the fourth. The option row
 * on a card (#24) puts a `showIf` and a row inside that stack, which is nine, and the library test
 * that counts a compiled body against its source is what said so.
 */
export const MAX_BLOCKS = 400;
export const MAX_DEPTH = 10;

/*
 * How deep lists and groups may nest inside one field, counting the field itself. A list of stages,
 * each holding a list of links, is two; a list of groups counts once. Past three a block is a
 * page, and a page is blocks.
 */
export const MAX_FIELD_DEPTH = 3;

/** The most entries a `list` holds when it names no `max` of its own. */
export const MAX_LIST_ITEMS = 100;

/** Refuses a definition that could never render, at startup rather than on some page later. */
export function checkDefinition(definition: BlockDefinition): void {
    if (!definition.type) throw new Error("a block definition needs a type");
    checkFields(definition.type, definition.fields as BlockField[], 0);
}

function checkFields(type: string, fields: BlockField[], depth: number): void {
    const names = new Set<string>();
    for (const field of fields) {
        if (!field.name) throw new Error(`block "${type}" has a field with no name`);
        if (names.has(field.name)) {
            throw new Error(`block "${type}" declares "${field.name}" twice`);
        }
        names.add(field.name);
        checkField(type, field, depth);
    }
}

function checkField(type: string, field: BlockField | (ListItem & { name: string }), depth: number): void {
    const where = `block "${type}" field "${field.name}"`;
    if (field.kind === "select" && !("options" in field && field.options?.length)) {
        throw new Error(`${where} is a select with no options`);
    }
    if (field.kind === "slots" && depth > 0) {
        throw new Error(`${where} is slots inside a list or a group, which holds values and not blocks`);
    }
    if (field.kind !== "list" && field.kind !== "group") return;
    if (depth + 1 > MAX_FIELD_DEPTH) {
        throw new Error(`${where} nests lists and groups more than ${MAX_FIELD_DEPTH} deep`);
    }
    if (field.kind === "group") {
        if (!field.fields?.length) throw new Error(`${where} is a group with no fields`);
        checkFields(type, field.fields, depth + 1);
        return;
    }
    const item = "item" in field ? field.item : undefined;
    if (!item || !LIST_ITEM_KINDS.includes(item.kind)) {
        throw new Error(`${where} needs an item kind, one of ${LIST_ITEM_KINDS.join(", ")}`);
    }
    if (item.kind === "group") {
        if (!item.fields?.length) throw new Error(`${where} is a list of groups with no fields`);
        checkFields(type, item.fields, depth + 1);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inRange(field: { min?: number; max?: number }, n: number): boolean {
    return (field.min === undefined || n >= field.min) && (field.max === undefined || n <= field.max);
}

/** A list's entry as a field of its own, so it is checked by the same rules a prop is. */
export function itemField(field: BlockField): BlockField {
    return { ...(field.item ?? { kind: "text" }), name: field.name };
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
    return readValue(field, value, "template") !== INVALID;
}

/*
 * The value a prop holds, cleaned, or INVALID.
 *
 * `template` is a stored value an editor typed, where a string may hold placeholders to resolve
 * later. `data` is what a binding already resolved to, where every string is literal: it is never
 * scanned again, which is the invariant bindings.ts holds for text and this holds for a list.
 *
 * A list or a group is copied rather than passed through, so a group hands its component only the
 * keys its fields declare, the same promise `readProps` makes for a block.
 */
export const INVALID: unique symbol = Symbol("invalid");

export type ReadMode = "template" | "data";

export function readValue(field: BlockField, value: unknown, mode: ReadMode): unknown {
    if (field.kind === "list") return readList(field, value, mode);
    if (field.kind === "group") return readGroup(field, value, mode);
    if (mode === "template" && typeof value === "string" && isBindable(field) && hasBinding(value)) {
        return acceptsValue(field, withoutBindings(field, value)) ? value : INVALID;
    }
    return acceptsValue(field, value) ? value : INVALID;
}

function isWholeBinding(field: BlockField, value: unknown, mode: ReadMode): value is string {
    return mode === "template" && typeof value === "string" && isBindable(field) && wholeBinding(value) !== null;
}

/*
 * A stored list that is too long or holds a wrong entry fails, the way any wrong stored value does:
 * an editor typed it and the console can show them. A bound list is the CMS's data, which nobody
 * editing the page can shorten, so an entry that fails its field is left out and the list is cut at
 * its `max`. Coming up short of `min` still fails, since fewer than that is not the block.
 */
function readList(field: BlockField, value: unknown, mode: ReadMode): unknown {
    if (isWholeBinding(field, value, mode)) return value;
    if (!Array.isArray(value)) return INVALID;
    const cap = Math.min(field.max ?? MAX_LIST_ITEMS, MAX_LIST_ITEMS);
    if (mode === "template" && value.length > cap) return INVALID;
    const entry = itemField(field);
    const out: unknown[] = [];
    for (const raw of value) {
        if (out.length >= cap) break;
        const read = raw === undefined || raw === null ? INVALID : readValue(entry, raw, mode);
        if (read === INVALID) {
            if (mode === "template") return INVALID;
            continue;
        }
        out.push(read);
    }
    if (out.length > 0 && !inRange(field, out.length)) return INVALID;
    return out;
}

function readGroup(field: BlockField, value: unknown, mode: ReadMode): unknown {
    if (isWholeBinding(field, value, mode)) return value;
    return readRecord(field.fields ?? [], value, mode) ?? INVALID;
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
        case "list":
        case "group":
            return false;
    }
}

/** Nothing there. An empty `list` reads as absent too, so a required one needs an entry. */
export function isAbsent(field: BlockField, value: unknown): boolean {
    if (value === undefined || value === null || value === "") return true;
    return field.kind === "list" && Array.isArray(value) && value.length === 0;
}

/*
 * Props through the block's fields, or null when the block must not render.
 *
 * A value that is present and wrong fails the whole block, even on an optional field. Dropping
 * just the value would render a call to action whose link was quietly removed, which is worse
 * than a missing block an editor can see is missing.
 */
export function readProps(fields: BlockField[], raw: unknown): BlockProps | null {
    return readRecord(fields, raw, "template");
}

export function readRecord(fields: BlockField[], raw: unknown, mode: ReadMode): BlockProps | null {
    if (!isRecord(raw)) return null;
    const props: BlockProps = {};
    for (const field of fields) {
        const value = Object.hasOwn(raw, field.name) ? raw[field.name] : undefined;
        const read = isAbsent(field, value) ? undefined : readValue(field, value, mode);
        if (read === INVALID) return null;
        if (read === undefined || isAbsent(field, read)) {
            if (field.required) return null;
            continue;
        }
        props[field.name] = read;
    }
    return props;
}

export interface ResolvedBlock {
    definition: BlockDefinition;
    props: BlockProps;
    /** Each `slots` field's lists, resolved. The raw lists are not left in `props`. */
    slots: Record<string, ResolvedBlock[][]>;
    /**
     * Set by the binder on a row of a `source` that holds a `filterBar`: the bar's id and the
     * values this row's field holds. `BlockList` writes both onto the block's wrapper.
     */
    filter?: { id: string; values: string[] };
}

export interface ResolveOptions {
    /** Whether blocks marked `perViewer` may render. False wherever the output is shared. */
    perViewer: boolean;
}

/*
 * A page over its budget used to render as though it ended there, with nothing said (#90): the
 * eighth of eight bands went missing on baryo.dev and the only symptom was a section a visitor
 * never saw. Raising the number from a hundred to four hundred (#83) bought room; it did not make
 * going over it visible. This is the sitemap's and the font allow list's own shape, `sayOnce` over a
 * bounded set: a page over budget still renders everything that fits, so a static export still
 * builds and a request still answers, but the drop is said once instead of guessed at from a
 * screenshot.
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
export function forgetBlockBudgetWarnings(): void {
    said.clear();
}

export function resolveBlocks(raw: unknown, registry: BlockRegistry, options: ResolveOptions): ResolvedBlock[] {
    const budget = { remaining: MAX_BLOCKS, truncated: false };
    const resolved = resolveList(raw, registry, options, 0, budget);
    if (budget.truncated) {
        // The top-level count, not a page id resolveBlocks is never given, but it is enough to tell
        // two different oversized pages apart: `sayOnce` dedups on the message text, and a warning
        // that reads the same for every page would say it for the first one only, which is the
        // silence #90 is about, moved rather than fixed. A site with two pages that both go over
        // budget and happen to store the same number of top-level blocks still only hears about the
        // first, which is the one gap this heuristic leaves.
        const stored = Array.isArray(raw) ? raw.length : 0;
        sayOnce(
            `blocks: a page storing ${stored} block${stored === 1 ? "" : "s"} held more than ${MAX_BLOCKS} ` +
                "once its bands were expanded into what they draw, so the rest were dropped and do not render. " +
                "The budget counts every block a band expands into, not only the bands a page author placed, " +
                "because that is what the work costs; split the page into more than one, or raise MAX_BLOCKS, " +
                "rather than reordering bands to work around it.",
        );
    }
    return resolved;
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
    budget: { remaining: number; truncated: boolean },
): ResolvedBlock[] {
    if (!Array.isArray(raw) || depth >= MAX_DEPTH) return [];

    const resolved: ResolvedBlock[] = [];
    for (const item of raw) {
        if (budget.remaining <= 0) {
            budget.truncated = true;
            break;
        }
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
            for (let i = 0; i < lists.length; i++) {
                const list = lists[i];
                if (budget.remaining <= 0) {
                    // An empty list was never going to cost anything: resolving one returns
                    // immediately with nothing read and nothing spent. Only a list that still
                    // holds something, asked for after budget ran out, was actually cut off, so
                    // that is what earns the warning; an empty one is skipped over for free and
                    // the field's own later lists still get their turn.
                    if (Array.isArray(list) && list.length > 0) {
                        budget.truncated = true;
                        break;
                    }
                    slots[field.name].push([]);
                    continue;
                }
                slots[field.name].push(resolveList(list, registry, options, depth + 1, budget));
            }
            delete props[field.name];
        }

        resolved.push({ definition, props, slots });
    }
    return resolved;
}

/** A field as the schema publishes it: bindability resolved, and every nested part copied. */
export type SchemaField = Omit<BlockField, "item" | "fields"> & {
    bindable: boolean;
    item?: Omit<ListItem, "fields"> & { bindable: boolean; fields?: SchemaField[] };
    fields?: SchemaField[];
};

export interface BlockSchema {
    /*
     * Still 2 with `list` and `group` in it, because they only add a kind and two keys. barakoBrew
     * 1.4.0 refuses a version it does not know and falls back to JSON for every block, but edits a
     * kind it does not know as JSON for that one field and keeps the rest of the form. A bump would
     * take the form editor away from every site until a new console shipped; this takes it away from
     * the new fields only.
     */
    version: 2;
    /** The scopes and formats a binding may name, so an editor offers exactly what renders. */
    bindings: { scopes: string[]; formats: string[] };
    blocks: {
        type: string;
        label: string;
        layer: "primitive" | "preset" | "data" | "block";
        perViewer: boolean;
        fields: SchemaField[];
    }[];
}

// Options copied too: the registry validates against its own array, and this result is handed to
// callers. `bindable` is resolved rather than passed through, so an editor reads one answer instead
// of reimplementing the default.
function publishField(f: BlockField): SchemaField {
    return {
        ...f,
        options: f.options ? [...f.options] : undefined,
        bindable: isBindable(f),
        item: f.item
            ? { ...f.item, bindable: isBindable(itemField(f)), fields: f.item.fields?.map(publishField) }
            : undefined,
        fields: f.fields?.map(publishField),
    };
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
            fields: (d.fields as BlockField[]).map(publishField),
        })),
    };
}
