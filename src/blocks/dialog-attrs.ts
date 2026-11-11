/*
 * The attributes a `dialog` block writes and its client code reads, and the stylesheet it draws
 * with, in a module with no directive. A server component importing from a "use client" module gets
 * a client reference for each export, not its value (see search-attrs.ts).
 */

/** The block's root: the trigger, the `<dialog>` and the script's marker live inside it. */
export const DIALOG_ATTR = "data-bp-dialog";
/** The trigger. Put away (`hidden`) until a script can open the dialog. */
export const DIALOG_OPEN_ATTR = "data-bp-dialog-open";
/** The native `<dialog>` element holding the content. */
export const DIALOG_PANEL_ATTR = "data-bp-dialog-panel";
/** The box inside it that carries the padding and the look, so a click on the dialog itself is the backdrop. */
export const DIALOG_BODY_ATTR = "data-bp-dialog-body";
/** The close button. A form with `method="dialog"` closes the dialog, so it needs no script. */
export const DIALOG_CLOSE_ATTR = "data-bp-dialog-close";
/** Set on the root when the browser has no `showModal`, so the content shows in the page instead. */
export const DIALOG_INLINE_ATTR = "data-bp-dialog-inline";

/*
 * Where there is no script the content shows in the page, in the flow of the row, because a closed
 * `<dialog>` is `display: none` and nothing could open it. `@media (scripting: none)` is the browser
 * saying so; a browser that cannot run `showModal` is given the same through DIALOG_INLINE_ATTR.
 * Without a script the trigger stays hidden and the close button, which would close nothing, goes.
 *
 * The block sets three variables on its root from the theme, and nothing here names a colour or a
 * length of its own: `--bp-dialog-ink` for the backdrop, `--bp-dialog-gap` for the room round the
 * panel, `--bp-dialog-width` for its width. The motion is last, and only inside
 * `prefers-reduced-motion: no-preference`, so a reader who asked for less sees the dialog appear.
 */
export function dialogCss(): string {
    const panel = `[${DIALOG_PANEL_ATTR}]`;
    const fallback: [string, string][] = [
        [`${panel}:not([open])`, "display:block;position:static;width:auto;max-width:none;max-height:none;margin:0"],
        [`[${DIALOG_CLOSE_ATTR}]`, "display:none"],
    ];
    const written = (scope: string) => fallback.map(([selector, rule]) => `${scope}${selector}{${rule}}`).join("");
    return (
        `${panel}{box-sizing:border-box;width:100%;` +
        `max-width:min(var(--bp-dialog-width),calc(100vw - 2 * var(--bp-dialog-gap)));` +
        `padding:0;border:0;background:transparent;color:inherit;overflow:visible}` +
        `[${DIALOG_BODY_ATTR}]{box-sizing:border-box;max-height:calc(100dvh - 2 * var(--bp-dialog-gap));overflow:auto}` +
        `${panel}::backdrop{background:color-mix(in srgb,var(--bp-dialog-ink) 55%,transparent)}` +
        `@media (scripting:none){${written("")}}` +
        written(`[${DIALOG_INLINE_ATTR}] `) +
        `@media (prefers-reduced-motion:no-preference){` +
        `${panel}[open]{animation:bp-dialog-in .16s ease-out}` +
        `${panel}[open]::backdrop{animation:bp-dialog-fade .16s ease-out}` +
        `@keyframes bp-dialog-in{from{opacity:0;transform:translateY(8px)}}` +
        `@keyframes bp-dialog-fade{from{opacity:0}}}`
    );
}
