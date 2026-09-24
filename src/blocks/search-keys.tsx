"use client";

import { useEffect } from "react";

/*
 * Keyboard handling for the search box, and the in-page filter over a tree's index.
 *
 * Over a route, it is an enhancement: the box is a form, the results are links, and a reader with no
 * script gets a working search. What this adds is what a form cannot do on its own: "/" focuses the
 * box from anywhere on the page, the arrow keys walk the results, escape clears and comes back, and an
 * index drawn into the page hidden is filtered as the reader types and put away when the reader moves
 * on. With no route behind the box, the index is the only search there is, and this is what runs it.
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
/** The line an index shows when nothing matched, holding the label it is written from. */
export const SEARCH_EMPTY_ATTR = "data-bp-search-empty";

/** The links a reader can walk to: what is drawn, not an index entry that is hidden. */
export function focusable(root: Element): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("a[href]")].filter((a) => !a.closest("[hidden]"));
}

/**
 * Shows the index entries whose text holds every word typed, the first few in reading order, and
 * hides the rest. The whole index, and the line that says nothing matched, stays hidden while the
 * box is empty. An entry is matched on the words it shows, so nothing is written into the page twice.
 */
export function filterIndex(index: HTMLElement, typed: string): void {
    const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = Number(index.getAttribute(SEARCH_INDEX_ATTR)) || 8;
    let count = 0;
    for (const entry of index.querySelectorAll<HTMLElement>("li")) {
        const text = (entry.textContent ?? "").toLowerCase();
        const match = words.length > 0 && count < shown && words.every((w) => text.includes(w));
        entry.hidden = !match;
        if (match) count++;
    }
    index.hidden = words.length === 0;
    const empty = index.querySelector<HTMLElement>(`[${SEARCH_EMPTY_ATTR}]`);
    if (empty) {
        empty.hidden = count > 0;
        // The label may name what was typed, as `{query}`.
        const template = empty.getAttribute(SEARCH_EMPTY_ATTR) ?? "";
        if (template.includes("{query}")) empty.textContent = template.split("{query}").join(typed.trim());
    }
}

/**
 * Everything the box does in the browser, wired to one input. Returns what undoes it.
 *
 * A plain function rather than the body of an effect, so it can be run, and tested, on markup with
 * no React behind it.
 */
export function wireSearch(input: HTMLInputElement): (() => void) | undefined {
    const root = input.closest(`[${SEARCH_ROOT_ATTR}]`);
    if (!root) return undefined;
    const index = root.querySelector<HTMLElement>(`[${SEARCH_INDEX_ATTR}]`);
    const form = input.form;

    const onInput = () => {
        if (index) filterIndex(index, input.value);
    };
    // Put away, not cleared: what was typed stays in the box and comes back when the box does.
    const hide = () => {
        if (index) index.hidden = true;
    };
    const first = (): HTMLAnchorElement | undefined => {
        const link = index ? focusable(index)[0] : undefined;
        return link instanceof HTMLAnchorElement ? link : undefined;
    };

    const onDocumentKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !root.contains(document.activeElement)) {
            hide();
            return;
        }
        if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
        const active = document.activeElement;
        // Not while somebody is typing a slash into a field of their own.
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        if (active instanceof HTMLElement && active.isContentEditable) return;
        e.preventDefault();
        input.focus();
    };

    /*
     * A press inside the box is held until it is done, so a result clicked in a browser that does not
     * focus links on a press (Safari) is not hidden from under the pointer by the focus leaving.
     */
    let pressing = false;
    const onPointerDown = (e: PointerEvent) => {
        if (e.target instanceof Node && root.contains(e.target)) {
            pressing = true;
            return;
        }
        hide();
    };
    const onPointerUp = () => {
        pressing = false;
    };
    const onFocusOut = (e: FocusEvent) => {
        if (pressing) return;
        const next = e.relatedTarget;
        if (next instanceof Node && root.contains(next)) return;
        hide();
    };

    // With an index, the box answers in the page. Enter goes to the first match. With no route behind
    // the box it never submits; with one, it submits there only when nothing matched.
    const onSubmit = (e: Event) => {
        if (!index) return;
        const link = first();
        if (!link) return;
        e.preventDefault();
        link.click();
    };
    const onEnter = (e: KeyboardEvent) => {
        if (e.key !== "Enter" || form || !index) return;
        e.preventDefault();
        first()?.click();
    };

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

    // What the browser put back in the box on a return visit is filtered too.
    onInput();

    document.addEventListener("keydown", onDocumentKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    root.addEventListener("keydown", onRoot as EventListener);
    root.addEventListener("focusout", onFocusOut as EventListener);
    input.addEventListener("input", onInput);
    input.addEventListener("focus", onInput);
    input.addEventListener("keydown", onEnter);
    form?.addEventListener("submit", onSubmit);
    return () => {
        document.removeEventListener("keydown", onDocumentKey);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointerup", onPointerUp, true);
        root.removeEventListener("keydown", onRoot as EventListener);
        root.removeEventListener("focusout", onFocusOut as EventListener);
        input.removeEventListener("input", onInput);
        input.removeEventListener("focus", onInput);
        input.removeEventListener("keydown", onEnter);
        form?.removeEventListener("submit", onSubmit);
    };
}

export function SearchKeys({ id }: { id: string }) {
    useEffect(() => {
        const input = document.getElementById(id);
        if (!(input instanceof HTMLInputElement)) return;
        return wireSearch(input);
    }, [id]);

    return null;
}
