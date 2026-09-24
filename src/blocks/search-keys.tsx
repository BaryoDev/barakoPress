"use client";

import { useEffect } from "react";

/*
 * Keyboard handling for the search box, and the in-page filter over a tree's index.
 *
 * It is an enhancement and nothing else. The box is a form, the results are links, and a reader with
 * no script gets a working search. What this adds is what a form cannot do on its own: "/" focuses the
 * box from anywhere on the page, the arrow keys walk the results, escape clears and comes back, and an
 * index drawn into the page hidden is filtered as the reader types.
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
/** Marks an in-page index, and holds how many of its entries show at once. */
export const SEARCH_INDEX_ATTR = "data-bp-search-index";
/** What an index entry is matched on, already lower case. */
export const SEARCH_TEXT_ATTR = "data-bp-search-text";
/** The line an index shows when nothing matched. */
export const SEARCH_EMPTY_ATTR = "data-bp-search-empty";

/** The links a reader can walk to: what is drawn, not an index entry that is hidden. */
function focusable(root: Element): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("a[href]")].filter((a) => !a.closest("[hidden]"));
}

/**
 * Shows the index entries whose text holds every word typed, the first few in reading order, and
 * hides the rest. The whole index, and the line that says nothing matched, stays hidden while the
 * box is empty.
 */
export function filterIndex(index: HTMLElement, typed: string): void {
    const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = Number(index.getAttribute(SEARCH_INDEX_ATTR)) || 8;
    let count = 0;
    for (const entry of index.querySelectorAll<HTMLElement>(`[${SEARCH_TEXT_ATTR}]`)) {
        const text = entry.getAttribute(SEARCH_TEXT_ATTR) ?? "";
        const match = words.length > 0 && count < shown && words.every((w) => text.includes(w));
        entry.hidden = !match;
        if (match) count++;
    }
    index.hidden = words.length === 0;
    const empty = index.querySelector<HTMLElement>(`[${SEARCH_EMPTY_ATTR}]`);
    if (empty) empty.hidden = count > 0;
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

        const index = root.querySelector<HTMLElement>(`[${SEARCH_INDEX_ATTR}]`);
        const onInput = () => {
            if (index) filterIndex(index, input.value);
        };
        // With an index, the box answers in the page: submitting goes to the first match rather than
        // to a route. With none showing, it submits as a form would.
        const onSubmit = (e: Event) => {
            if (!index) return;
            const first = focusable(index)[0];
            if (!(first instanceof HTMLAnchorElement)) return;
            e.preventDefault();
            first.click();
        };
        // What the browser put back in the box on a return visit is filtered too.
        onInput();

        const onRoot = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                input.value = "";
                onInput();
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

        const form = input.form;
        document.addEventListener("keydown", onDocument);
        root.addEventListener("keydown", onRoot as EventListener);
        input.addEventListener("input", onInput);
        form?.addEventListener("submit", onSubmit);
        return () => {
            document.removeEventListener("keydown", onDocument);
            root.removeEventListener("keydown", onRoot as EventListener);
            input.removeEventListener("input", onInput);
            form?.removeEventListener("submit", onSubmit);
        };
    }, [id]);

    return null;
}
