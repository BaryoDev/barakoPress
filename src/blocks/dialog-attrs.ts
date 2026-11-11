/*
 * The attributes a `dialog` block writes and its client code reads, and the stylesheet it draws
 * with, in a module with no directive. A server component importing from a "use client" module gets
 * a client reference for each export, not its value (see search-attrs.ts).
 */

/** The block's root: the trigger, the `<dialog>` and the script's marker live inside it. */
export const DIALOG_ATTR = "data-bp-dialog";
/** The trigger: a link to the dialog's own id, so it works with no script. */
export const DIALOG_OPEN_ATTR = "data-bp-dialog-open";
/** The native `<dialog>` element holding the content. */
export const DIALOG_PANEL_ATTR = "data-bp-dialog-panel";
/** The box inside it that carries the padding and the look, so a click on the dialog itself is the backdrop. */
export const DIALOG_BODY_ATTR = "data-bp-dialog-body";
/** The close control: a link back to the trigger, which the script turns into a button that closes. */
export const DIALOG_CLOSE_ATTR = "data-bp-dialog-close";

/*
 * Without the script the trigger is still there, drawn by the server, and it is a link to the
 * dialog's id. A closed `<dialog>` is `display: none`, so `:target` shows it as ordinary content in
 * the row when the link is followed, and the close link goes back to the trigger. Nothing is hidden
 * or revealed when the script arrives, so hydration moves nothing; the script only stops the link
 * from navigating and opens the modal instead. If the script never runs, the link still reaches the
 * content.
 *
 * The block sets three variables on its root from the theme: `--bp-dialog-ink` for the backdrop,
 * `--bp-dialog-gap` for the room round the panel and `--bp-dialog-width` for its width. The colour
 * and the lengths come from the theme through them; what is written here is the engine's own
 * mechanics: the backdrop's strength, and the length of the fade. The motion is last and only inside
 * `prefers-reduced-motion: no-preference`, so a reader who asked for less sees the dialog appear.
 */
export function dialogCss(): string {
    const panel = `[${DIALOG_PANEL_ATTR}]`;
    return (
        `${panel}{box-sizing:border-box;width:100%;` +
        `max-width:min(var(--bp-dialog-width),calc(100vw - 2 * var(--bp-dialog-gap)));` +
        `padding:0;border:0;background:transparent;color:inherit;overflow:visible}` +
        `[${DIALOG_BODY_ATTR}]{box-sizing:border-box;max-height:calc(100dvh - 2 * var(--bp-dialog-gap));overflow:auto}` +
        `${panel}::backdrop{background:color-mix(in srgb,var(--bp-dialog-ink) 55%,transparent)}` +
        `${panel}:target:not([open]){display:block;position:static;width:auto;max-width:none;max-height:none;margin:0}` +
        `@media (prefers-reduced-motion:no-preference){` +
        `${panel}[open]{animation:bp-dialog-in .16s ease-out}` +
        `${panel}[open]::backdrop{animation:bp-dialog-fade .16s ease-out}` +
        `@keyframes bp-dialog-in{from{opacity:0;transform:translateY(8px)}}` +
        `@keyframes bp-dialog-fade{from{opacity:0}}}`
    );
}
