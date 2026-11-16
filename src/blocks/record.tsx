import type { CSSProperties } from "react";
import { withBase } from "../base-path.js";
import { defineBlock, type BlockDefinition } from "./schema.js";
import { collectionField } from "./data.js";
import { BINDING_FORMATS } from "./bindings.js";
import type { PressConfig } from "../config.js";
import { sitePath } from "../site-path.js";
import { spaceOf } from "./tokens.js";

/*
 * The Operator desk's two blocks (barakoPress #7).
 *
 * `recordPanel` shows one entry of a collection, read as the signed-in viewer. `transitionButton`
 * is a form that posts to the viewer transition route, which moves the entry through its workflow
 * as that viewer. Both read the entry id from a URL parameter, so a `dataTable` row link such as
 * `/staff/catering?record={id}` selects the entry.
 *
 * The reading and the id check happen in the binder, on the server. These components only draw the
 * state it wrote. No token reaches either one.
 */

export const RECORD_PANEL_BLOCK = "recordPanel";
export const TRANSITION_BUTTON_BLOCK = "transitionButton";

/** Where the transition form posts. Mount `createViewerTransitionRoute` here. */
export const TRANSITION_ACTION = "/api/viewer/transition";

export const MAX_RECORD_FIELDS = 30;

/** Names that go in a URL or a form: the parameter names, a transition name and a field name. */
export const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
export const TRANSITION_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
export const REASON_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const MAX_REASON = 1000;

/**
 * What the `result` parameter may say. The route writes one of these keys and the panel looks it up
 * here, so text in the URL is never drawn. An unknown key draws nothing.
 */
export const RESULT_MESSAGES: ReadonlyMap<string, { text: string; ok: boolean }> = new Map([
    ["done", { text: "The decision was recorded.", ok: true }],
    ["reason", { text: "A reason is required.", ok: false }],
    ["forbidden", { text: "Your account may not make that decision.", ok: false }],
    ["missing", { text: "That entry could not be found.", ok: false }],
    ["conflict", { text: "The entry changed while you were looking. Check it and try again.", ok: false }],
    ["invalid", { text: "The workflow did not accept that.", ok: false }],
    ["unavailable", { text: "The decision could not be sent. Try again.", ok: false }],
]);

export interface RecordPanelState {
    found: boolean;
    rows: { label: string; text: string }[];
    status?: string;
    message?: { text: string; ok: boolean };
}

export function writeRecordState(state: RecordPanelState): string {
    return JSON.stringify(state);
}

export function readRecordState(value: string | undefined): RecordPanelState | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<RecordPanelState>;
        if (typeof parsed.found !== "boolean" || !Array.isArray(parsed.rows)) return null;
        return parsed as RecordPanelState;
    } catch {
        return null;
    }
}

type RecordPanelProps = {
    collection: string;
    recordParam?: string;
    resultParam?: string;
    fields?: { field: string; label?: string; format?: string }[];
    statusLabel?: string;
    empty?: string;
    state?: string;
};

function recordPanel(config: PressConfig): BlockDefinition {
    return defineBlock<RecordPanelProps>({
        type: RECORD_PANEL_BLOCK,
        label: "Record panel",
        layer: "block",
        fields: [
            collectionField(config, "Collection"),
            { name: "recordParam", kind: "text", label: "URL parameter holding the entry id", bindable: false },
            { name: "resultParam", kind: "text", label: "URL parameter holding the result key", bindable: false },
            {
                name: "fields",
                kind: "list",
                label: "Fields to show, in order",
                max: MAX_RECORD_FIELDS,
                item: {
                    kind: "group",
                    label: "Field",
                    fields: [
                        { name: "field", kind: "text", label: "Field", required: true, bindable: false },
                        { name: "label", kind: "text", label: "Label" },
                        { name: "format", kind: "select", label: "Show as", options: [...BINDING_FORMATS] },
                    ],
                },
            },
            { name: "statusLabel", kind: "text", label: "Label for the status" },
            { name: "empty", kind: "text", label: "Say this when no entry is shown" },
            // Written by the binder, never by an editor.
            { name: "state", kind: "text", label: "Panel state", bindable: false },
        ],
        component: ({ props, theme }) => {
            const state = readRecordState(props.state);
            const c = theme.colors;
            if (!state || !state.found) return props.empty ? <p style={{ fontSize: theme.text.small }}>{props.empty}</p> : null;
            const term: CSSProperties = { color: c.secondaryInk, fontSize: theme.text.small };
            const value: CSSProperties = { margin: 0, fontSize: theme.text.body };
            return (
                <section data-press="record-panel" style={{ display: "grid", gap: spaceOf(theme, "md") }}>
                    {state.message && (
                        <p role="status" data-result={state.message.ok ? "ok" : "refused"} style={{ margin: 0, fontWeight: 600 }}>
                            {state.message.text}
                        </p>
                    )}
                    <dl style={{ display: "grid", gap: spaceOf(theme, "sm"), margin: 0 }}>
                        {state.status !== undefined && (
                            <div>
                                <dt style={term}>{props.statusLabel || "Status"}</dt>
                                <dd data-press="record-status" style={{ ...value, fontWeight: 600 }}>
                                    {state.status}
                                </dd>
                            </div>
                        )}
                        {state.rows.map((row, i) => (
                            <div key={i}>
                                <dt style={term}>{row.label}</dt>
                                <dd style={value}>{row.text}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            );
        },
    });
}

type TransitionButtonProps = {
    label: string;
    transition: string;
    requireReason?: boolean;
    reasonLabel?: string;
    reasonField?: string;
    collection: string;
    recordParam?: string;
    resultParam?: string;
    next?: string;
    state?: string;
};

function transitionButton(config: PressConfig): BlockDefinition {
    return defineBlock<TransitionButtonProps>({
        type: TRANSITION_BUTTON_BLOCK,
        label: "Transition button",
        layer: "block",
        fields: [
            { name: "label", kind: "text", label: "Button text", required: true },
            { name: "transition", kind: "text", label: "Transition name", required: true, bindable: false },
            { name: "requireReason", kind: "boolean", label: "Ask for a reason and require it" },
            { name: "reasonLabel", kind: "text", label: "Label for the reason box" },
            { name: "reasonField", kind: "text", label: "Transition field that takes the reason", bindable: false },
            collectionField(config, "Collection"),
            { name: "recordParam", kind: "text", label: "URL parameter holding the entry id", bindable: false },
            { name: "resultParam", kind: "text", label: "URL parameter for the result key", bindable: false },
            { name: "next", kind: "text", label: "Page to come back to (a site path)", bindable: false },
            // Written by the binder, never by an editor.
            { name: "state", kind: "text", label: "Button state", bindable: false },
        ],
        component: ({ props, theme }) => {
            let record = "";
            try {
                record = String((JSON.parse(props.state ?? "{}") as { record?: unknown }).record ?? "");
            } catch {
                record = "";
            }
            if (record === "") return null;
            const field: CSSProperties = {
                display: "block",
                width: "100%",
                padding: spaceOf(theme, "sm"),
                marginTop: spaceOf(theme, "xs"),
                font: "inherit",
                color: theme.colors.ink,
                background: theme.colors.surface,
                border: `1px solid ${theme.colors.hairline}`,
                borderRadius: theme.radii.control,
            };
            const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
            return (
                <form
                    method="post"
                    action={withBase(TRANSITION_ACTION)}
                    data-press="transition-button"
                    style={{ display: "grid", gap: spaceOf(theme, "sm"), maxWidth: "24rem" }}
                >
                    {hidden("record", record)}
                    {hidden("transition", props.transition)}
                    {hidden("collection", props.collection)}
                    {hidden("recordParam", props.recordParam || "record")}
                    {hidden("resultParam", props.resultParam || "result")}
                    {hidden("next", sitePath(props.next))}
                    {props.requireReason === true && hidden("reasonRequired", "1")}
                    {props.requireReason === true && hidden("reasonField", props.reasonField || "Reason")}
                    {props.requireReason === true && (
                        <label>
                            {props.reasonLabel || "Reason"}
                            <textarea name="reason" required maxLength={MAX_REASON} rows={3} style={field} />
                        </label>
                    )}
                    <button type="submit" style={{ ...field, width: "auto", cursor: "pointer" }}>
                        {props.label}
                    </button>
                </form>
            );
        },
    });
}

export function recordBlocks(config: PressConfig): BlockDefinition[] {
    return [recordPanel(config), transitionButton(config)];
}
