// Stands in for next/link's default export: an anchor tag, which is what it renders down to and
// all a server-rendered component test needs from it. See next-stub-loader.mjs for why this exists.
import { createElement } from "react";

export default function Link({ href, children, ...rest }) {
    return createElement("a", { href, ...rest }, children);
}
