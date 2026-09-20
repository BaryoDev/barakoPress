"use client";

import { useEffect } from "react";

/*
 * Keyboard handling for the search box, and the only client component in the package.
 *
 * It is an enhancement and nothing else. The box is a form, the results are links, and a reader with
 * no script gets a working search. What this adds is what a form cannot do on its own: "/" focuses the
 * box from anywhere on the page, the arrow keys walk the results, and escape clears and comes back.
 *
 * It is handed an id and reads the DOM the server already rendered, rather than being handed the
 * results as props. A client component's props are serialised into the page, so passing the results
 * would ship every hit twice, once as markup and once as data.
 *
 * `barakoPress` is `type: module` and compiled per file by tsc, which leaves this directive where it
 * is. That is why the build may not gain a bundler: a bundler is free to move a file level marker
 * Next reads off the module it resolves. See CLAUDE.md, section 2a.
 */

/** The attribute the box marks its root with, so the listeners stay inside one box on a page with two. */
export const SEARCH_ROOT_ATTR = "data-bp-search";

function focusable(root: Element): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("a[href]")];
}

export function SearchKeys({ id }: { id: string }) {
    useEffect(() => {
        const input = document.getElementById(id);
        if (!(input instanceof HTMLInputElement)) return;
        const root = input.closest(`[${SEARCH_ROOT_ATTR}]`);
        if (!root) return;

        const onDocument = (e: KeyboardEvent) => {
            if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
            const active = document.activeElement;
            // Not while somebody is typing a slash into a field of their own.
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
            if (active instanceof HTMLElement && active.isContentEditable) return;
            e.preventDefault();
            input.focus();
        };

        const onRoot = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                input.value = "";
                input.focus();
                return;
            }
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            const links = focusable(root);
            if (links.length === 0) return;
            e.preventDefault();
            const at = links.indexOf(document.activeElement as HTMLElement);
            if (e.key === "ArrowDown") {
                links[at < 0 ? 0 : Math.min(at + 1, links.length - 1)].focus();
                return;
            }
            // Up from the first result goes back to the box, which is where the reader came from.
            if (at <= 0) input.focus();
            else links[at - 1].focus();
        };

        document.addEventListener("keydown", onDocument);
        root.addEventListener("keydown", onRoot as EventListener);
        return () => {
            document.removeEventListener("keydown", onDocument);
            root.removeEventListener("keydown", onRoot as EventListener);
        };
    }, [id]);

    return null;
}
