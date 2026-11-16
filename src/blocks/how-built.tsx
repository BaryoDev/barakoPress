import { defineBlock, type BlockDefinition } from "./schema.js";
import { spaceOf } from "./tokens.js";

/*
 * "How is this built?" (barakoPress #7, the operator desk).
 *
 * A native disclosure, closed by default, that shows the page's own block configuration as JSON,
 * the way barakoBrew shows it: each block's type and props as authored, with its nested blocks in
 * place. The binder writes the text into `state` before anything is resolved against a viewer, a
 * collection or the URL, so a `{{viewer.Username}}` shows as written and no value is in it. State
 * that other blocks get from binding, a block that a gate or a `showIf` leaves out for this viewer,
 * and anything past the size limits are not in it either.
 *
 * It is `perViewer`, so a shared page never draws it. It only draws on `createViewerPage`.
 */

export const HOW_BUILT_BLOCK = "howBuilt";

/** How many blocks the listing holds, and the longest string it prints. Past either it stops. */
export const MAX_HOW_BUILT_BLOCKS = 200;
export const MAX_HOW_BUILT_TEXT = 1000;

type HowBuiltProps = { summary?: string; state?: string };

export function howBuiltBlocks(): BlockDefinition[] {
    return [
        defineBlock<HowBuiltProps>({
            type: HOW_BUILT_BLOCK,
            label: "How is this built?",
            layer: "block",
            perViewer: true,
            fields: [
                { name: "summary", kind: "text", label: "Heading of the disclosure" },
                // Written by the binder, never by an editor.
                { name: "state", kind: "text", label: "Configuration listing", bindable: false },
            ],
            component: ({ props, theme }) => {
                if (!props.state) return null;
                const c = theme.colors;
                return (
                    <details data-press="how-built" style={{ fontSize: theme.text.small }}>
                        <summary style={{ cursor: "pointer", color: c.secondaryInk }}>{props.summary || "How is this built?"}</summary>
                        <pre
                            style={{
                                margin: `${spaceOf(theme, "sm")} 0 0`,
                                padding: spaceOf(theme, "md"),
                                overflow: "auto",
                                fontFamily: theme.fonts.mono,
                                color: c.ink,
                                background: c.surface,
                                border: `1px solid ${c.hairline}`,
                                borderRadius: theme.radii.control,
                            }}
                        >
                            <code>{props.state}</code>
                        </pre>
                    </details>
                );
            },
        }),
    ];
}
