/*
 * A disclosure that opens and closes with motion (#235). The panel is the `details` element's own
 * `::details-content`, a grid whose one row goes from 0fr to 1fr, so the height animates without a
 * measured pixel value. `content-visibility` is transitioned with it so the close is seen before the
 * panel is taken out. A browser without `::details-content` skips the block and gets the native
 * open and close, and so does a visitor who asked for reduced motion, because every rule sits inside
 * `prefers-reduced-motion: no-preference`, the same guard `motion.ts` uses. The markup is the same
 * either way, so find in page and the keyboard behave as `details` does.
 *
 * Its own file because `motion.ts` is not editable as text here (it holds a NUL byte). It follows
 * that file's shape and can move into it.
 */
export function disclosureCss(): string {
    return (
        `@media (prefers-reduced-motion:no-preference){` +
        `@supports selector(::details-content){` +
        `[data-bp-disclosure]::details-content{display:grid;grid-template-rows:0fr;` +
        `transition:grid-template-rows .4s cubic-bezier(.2,.8,.2,1),content-visibility .4s allow-discrete}` +
        `[data-bp-disclosure][open]::details-content{grid-template-rows:1fr}` +
        `[data-bp-disclosure-body]{overflow:hidden;min-height:0}` +
        `}}`
    );
}
