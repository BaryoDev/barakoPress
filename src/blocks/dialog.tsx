import { useId, type CSSProperties } from "react";
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
import { slotVariable } from "../theme.js";
import { spaceOf } from "./tokens.js";

/*
 * A dialog that opens from a trigger (#254), drawn once for each row when it sits in a `repeat`.
 *
 * The content is the block's `content` slot, bound in the row's own scope like any other block's, so
 * `{{item.Title}}` in it is that row's. The markup is a native `<dialog>`, which is what gives Escape,
 * the inert page behind it and the top layer for free.
 *
 * The trigger is a link to the dialog's own id, drawn by the server, and the content shows in the page
 * when that id is the URL's target (see dialog-attrs.ts). So with no script, or a script that never
 * ran, the content is reachable from the trigger; and because the trigger is drawn in the markup and
 * nothing is hidden or revealed when the script arrives, hydration shifts no layout. The id comes from
 * `useId`, so a page with many rows, or two sources, never repeats one.
 *
 * The look is from the theme or a style recipe. A colour is read as a theme variable first, with the
 * theme's own value as the fallback, so a theme variant (a dark one) reaches the panel and the
 * backdrop as it does the layout's regions. Lengths are the theme's spaces; the stylesheet's own
 * numbers are the backdrop's strength and the fade's length.
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
        const id = useId();
        const panelId = `bp-dialog-${id}`;
        const openId = `${panelId}-open`;
        // The variable a variant sets, else the theme's own colour.
        const live = (slot: "ink" | "surface" | "hairline") => `var(${slotVariable(slot)},${theme.colors[slot]})`;
        const c = { ink: live("ink"), surface: live("surface"), hairline: live("hairline") };
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
            display: "inline-block",
            textDecoration: "none",
            padding: `${spaceOf(theme, "xs")} ${spaceOf(theme, "sm")}`,
            borderRadius: theme.radii.pill,
            border: `1px solid ${c.hairline}`,
            background: c.surface,
            color: c.ink,
            font: "inherit",
            fontSize: theme.text.small,
            fontWeight: 600,
        });
        const close = worn(props.closeRecipe, {
            padding: `${spaceOf(theme, "xs")} ${spaceOf(theme, "sm")}`,
            borderRadius: theme.radii.control,
            border: `1px solid ${c.hairline}`,
            background: c.surface,
            color: c.ink,
            display: "inline-block",
            textDecoration: "none",
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
                <a
                    id={openId}
                    href={`#${panelId}`}
                    aria-haspopup="dialog"
                    {...{ [DIALOG_OPEN_ATTR]: "" }}
                    style={{ cursor: "pointer", ...open.style }}
                    className={open.className}
                >
                    {props.trigger}
                </a>
                <dialog id={panelId} {...{ [DIALOG_PANEL_ATTR]: "" }} aria-label={props.label ?? props.trigger}>
                    <div {...{ [DIALOG_BODY_ATTR]: "" }} style={panel.style} className={panel.className}>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: spaceOf(theme, "sm") }}>
                            <a href={`#${openId}`} {...{ [DIALOG_CLOSE_ATTR]: "" }} style={{ cursor: "pointer", ...close.style }} className={close.className}>
                                {props.closeLabel ?? "Close"}
                            </a>
                        </div>
                        {slots.content?.[0]}
                    </div>
                </dialog>
                <style href="bp-dialog" precedence="bp-dialog" dangerouslySetInnerHTML={{ __html: dialogCss() }} />
                <DialogKeys />
            </div>
        );
    },
});
