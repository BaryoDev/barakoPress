"use client";

import { useEffect } from "react";
import {
    FILTER_COUNT_ATTR,
    FILTER_EMPTY_ATTR,
    FILTER_INPUT_ATTR,
    FILTER_MISS_ATTR,
    FILTER_ROW_ATTR,
} from "./filter.js";
import { foldText } from "./search-attrs.js";

/*
 * What a `filterInput` does in the browser (#254), wired to one input.
 *
 * The rows are server markup, and the server numbered them: every block of one row carries
 * `data-bp-filter-row="<id>:<n>"`. Typing marks the blocks of the rows the words left out with
 * `data-bp-filter-miss`, and one rule the server wrote hides what is marked, the same way a
 * `filterBar` hides by `data-bp-filter-value`. Nothing here sets a style, so the two filters
 * combine: a row shows when both let it.
 *
 * It is handed an id and reads the DOM, as the search box does, so no row is serialised twice. The
 * box is `hidden` until this runs, so a page with no script shows every row and no dead field.
 *
 * Written as one self-contained function (plus `foldText`) so the look check can run the compiled
 * code on a page with no React behind it: `look/build-filter-input-fixture.mjs` pastes both in by
 * `toString`, and a helper added outside `wireFilterInput` has to be pasted there too.
 */
export function wireFilterInput(input: HTMLInputElement): (() => void) | undefined {
    const root = input.closest<HTMLElement>(`[${FILTER_INPUT_ATTR}]`);
    if (!root) return undefined;
    const id = root.getAttribute(FILTER_INPUT_ATTR) ?? "";
    const scope = root.closest<HTMLElement>('[data-block="source"]') ?? document.body;
    const count = root.querySelector<HTMLElement>(`[${FILTER_COUNT_ATTR}]`);
    const empty = root.querySelector<HTMLElement>(`[${FILTER_EMPTY_ATTR}]`);

    // The rows: each one's blocks, and its text folded the first time it is needed. Collected again
    // whenever the page changes under the box, since a refresh or a page of the source can replace
    // the rows while this stays mounted.
    let rows = new Map<string, { blocks: HTMLElement[]; text?: string }>();
    const collect = () => {
        rows = new Map();
        for (const block of scope.querySelectorAll<HTMLElement>(`[${FILTER_ROW_ATTR}]`)) {
            for (const token of (block.getAttribute(FILTER_ROW_ATTR) ?? "").split(" ")) {
                if (!token.startsWith(`${id}:`)) continue;
                const row = rows.get(token) ?? { blocks: [] };
                row.blocks.push(block);
                rows.set(token, row);
            }
        }
    };
    collect();

    // What a reader can read: a block's own stylesheet or script is in its textContent and is not text.
    const visibleText = (block: HTMLElement) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) =>
                node.parentElement?.closest("style, script, noscript, template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
        });
        let out = "";
        for (let node = walker.nextNode(); node; node = walker.nextNode()) out += `${node.nodeValue} `;
        return out;
    };

    const say = (el: HTMLElement | null, text: string) => {
        if (!el) return;
        // Only when it changed, so the observer below does not hear its own write and loop.
        if (el.textContent !== text) el.textContent = text;
        el.style.marginTop = text === "" ? "" : "var(--bp-fi-gap)";
    };

    const mark = (block: HTMLElement, missed: boolean) => {
        const ids = (block.getAttribute(FILTER_MISS_ATTR) ?? "").split(" ").filter((t) => t !== "" && t !== id);
        if (missed) ids.push(id);
        if (ids.length > 0) block.setAttribute(FILTER_MISS_ATTR, ids.join(" "));
        else block.removeAttribute(FILTER_MISS_ATTR);
    };

    // What is on screen, counted from what the browser shows, so a bar's choice counts too.
    const recount = () => {
        const typed = input.value;
        const words = foldText(typed.trim()).split(/\s+/).filter(Boolean);
        let shown = 0;
        for (const row of rows.values()) {
            if (getComputedStyle(row.blocks[0]).display !== "none") shown++;
        }
        const total = rows.size;
        const template = (el: HTMLElement | null, attr: string) => el?.getAttribute(attr) ?? "";
        // Said aloud only while the rows are narrowed: an untouched list announces nothing.
        const narrowed = words.length > 0 || shown < total;
        say(
            count,
            narrowed && shown > 0
                ? template(count, FILTER_COUNT_ATTR).split("{count}").join(String(shown)).split("{total}").join(String(total))
                : "",
        );
        say(empty, narrowed && shown === 0 ? template(empty, FILTER_EMPTY_ATTR).split("{query}").join(typed.trim()) : "");
    };

    /*
     * The rows follow the keys at once; what is said aloud waits for the reader to stop, so a screen
     * reader is not told a count for every letter. Every change of the page that could move the count
     * lands here too, so a burst of them is one recount.
     */
    let pending: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
        clearTimeout(pending);
        pending = setTimeout(recount, 400);
    };

    const apply = () => {
        const typed = input.value;
        const words = foldText(typed.trim()).split(/\s+/).filter(Boolean);
        for (const row of rows.values()) {
            row.text ??= foldText(row.blocks.map(visibleText).join(" "));
            const text = row.text;
            const missed = !words.every((word) => text.includes(word));
            for (const block of row.blocks) mark(block, missed);
        }
        settle();
    };

    // An input method is mid-word until it says so: filtering on each candidate would hide rows
    // for text that is not there yet.
    const onInput = (e: Event) => {
        if ((e as InputEvent).isComposing) return;
        apply();
    };

    const onInputKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.isComposing || input.value === "") return;
        input.value = "";
        apply();
    };
    const onDocumentKey = (e: KeyboardEvent) => {
        if (e.key !== "/" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
        const active = document.activeElement;
        // Not while somebody is typing a slash into a field of their own.
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
        if (active instanceof HTMLElement && active.isContentEditable) return;
        e.preventDefault();
        input.focus();
    };

    // A bar writes its choice onto its own group and a rule beside it, after this ran: count again.
    let watcher: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
        watcher = new MutationObserver((records) => {
            // The box's own count and no-match writes are not a change to the rows.
            const own = (node: Node) => (count?.contains(node) ?? false) || (empty?.contains(node) ?? false);
            if (records.every((record) => own(record.target))) return;
            collect();
            apply();
        });
        watcher.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-bp-filter-value"] });
    }

    root.hidden = false;
    // What the browser put back in the box on a return visit is filtered too.
    apply();
    input.addEventListener("input", onInput);
    input.addEventListener("compositionend", apply);
    input.addEventListener("keydown", onInputKey);
    document.addEventListener("keydown", onDocumentKey);
    return () => {
        watcher?.disconnect();
        clearTimeout(pending);
        input.removeEventListener("input", onInput);
        input.removeEventListener("compositionend", apply);
        input.removeEventListener("keydown", onInputKey);
        document.removeEventListener("keydown", onDocumentKey);
        for (const row of rows.values()) for (const block of row.blocks) mark(block, false);
        root.hidden = true;
    };
}

export function FilterInputKeys({ id }: { id: string }) {
    useEffect(() => {
        const root = document.querySelector(`[${FILTER_INPUT_ATTR}="${CSS.escape(id)}"]`);
        const input = root?.querySelector("input");
        if (!(input instanceof HTMLInputElement)) return;
        return wireFilterInput(input);
    }, [id]);

    return null;
}
