import type { CSSProperties } from "react";
import { recipeLook } from "../recipes.js";
import { DialogKeys } from "./dialog-keys.js";
import {
    DIALOG_ATTR,
    DIALOG_BODY_ATTR,
    DIALOG_CLOSE_ATTR,
    DIALOG_OPEN_ATTR,
    DIALOG_PANEL_ATTR,
    dialogCss,
} from "./dialog-attrs.js";
import { defineBlock } from "./schema.js";
import { spaceOf } from "./tokens.js";

/*
 * A dialog that opens from a trigger (#254), drawn once for each row when it sits in a `repeat`.
 *
 * The content is the block's `content` slot, bound in the row's own scope like any other block's, so
 * `{{item.Title}}` in it is that row's. The markup is a native `<dialog>`, which is what gives Escape,
 * the inert page behind it and the top layer for free. With no script the stylesheet shows the content
 * in the page (see dialog-attrs.ts), which is the smallest fallback that reaches it: a `<details>`
 * would need the content in the markup twice, or moved at run time under React's feet. What it costs is
 * a reader whose browser says scripting is on and whose script never ran: that reader sees the
 * trigger stay hidden. The same holds for every control the engine adds a script to.
 *
 * Every look is from the theme or a style recipe. The block names no colour and no length of its own:
 * three variables on its root carry the theme's ink, a space and a width to the stylesheet, and the
 * panel, the trigger and the close button are drawn from tokens unless a recipe replaces them.
 */
export const DIALOG_BLOCK = "dialog";

type DialogProps = {
    trigger: string;
    label?: string;
    closeLabel?: string;
    recipe?: string;
    triggerRecipe?: string;
    closeRecipe?: string;
};

export const dialogBlock = defineBlock<DialogProps, "content">({
    type: DIALOG_BLOCK,
    label: "Dialog",
    layer: "primitive",
    fields: [
        { name: "trigger", kind: "text", label: "The button that opens it", required: true },
        { name: "label", kind: "text", label: "The dialog's name for a screen reader, else the button's words" },
        { name: "closeLabel", kind: "text", label: "The close button" },
        { name: "recipe", kind: "text", label: "Style recipe, the panel" },
        { name: "triggerRecipe", kind: "text", label: "Style recipe, the button that opens it" },
        { name: "closeRecipe", kind: "text", label: "Style recipe, the close button" },
        { name: "content", kind: "slots", label: "Content", required: true, min: 1, max: 1 },
    ],
    component: ({ props, slots, theme }) => {
        const c = theme.colors;
        const worn = (name: string | undefined, fallback: CSSProperties) => {
            const found = recipeLook(theme, name);
            return found ? { style: found.style, className: found.className || undefined } : { style: fallback, className: undefined };
        };
        const panel = worn(props.recipe, {
            padding: spaceOf(theme, "lg"),
            background: c.surface,
            color: c.ink,
            border: `1px solid ${c.hairline}`,
            borderRadius: theme.radii.panel,
        });
        const open = worn(props.triggerRecipe, {
            padding: "8px 15px",
            borderRadius: theme.radii.pill,
            border: `1px solid ${c.hairline}`,
            background: c.surface,
            color: c.ink,
            font: "inherit",
            fontSize: theme.text.small,
            fontWeight: 600,
        });
        const close = worn(props.closeRecipe, {
            padding: "6px 12px",
            borderRadius: theme.radii.control,
            border: `1px solid ${c.hairline}`,
            background: c.surface,
            color: c.ink,
            font: "inherit",
            fontSize: theme.text.small,
        });
        const root = {
            "--bp-dialog-ink": c.ink,
            "--bp-dialog-gap": spaceOf(theme, "md"),
            "--bp-dialog-width": theme.layout.prose,
        } as CSSProperties;
        return (
            <div {...{ [DIALOG_ATTR]: "" }} style={root}>
                {/* A button that does nothing without the script is not drawn until the script is there. */}
                <button
                    type="button"
                    hidden
                    aria-haspopup="dialog"
                    {...{ [DIALOG_OPEN_ATTR]: "" }}
                    style={{ cursor: "pointer", ...open.style }}
                    className={open.className}
                >
                    {props.trigger}
                </button>
                <dialog {...{ [DIALOG_PANEL_ATTR]: "" }} aria-label={props.label ?? props.trigger}>
                    <div {...{ [DIALOG_BODY_ATTR]: "" }} style={panel.style} className={panel.className}>
                        <form method="dialog" style={{ display: "flex", justifyContent: "flex-end", margin: 0, marginBottom: spaceOf(theme, "sm") }}>
                            <button type="submit" {...{ [DIALOG_CLOSE_ATTR]: "" }} style={{ cursor: "pointer", ...close.style }} className={close.className}>
                                {props.closeLabel ?? "Close"}
                            </button>
                        </form>
                        {slots.content?.[0]}
                    </div>
                </dialog>
                <style href="bp-dialog" precedence="bp-dialog" dangerouslySetInnerHTML={{ __html: dialogCss() }} />
                <DialogKeys />
            </div>
        );
    },
});
