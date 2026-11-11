"use client";

import { useEffect, useRef } from "react";
import { DIALOG_ATTR, DIALOG_CLOSE_ATTR, DIALOG_OPEN_ATTR, DIALOG_PANEL_ATTR } from "./dialog-attrs.js";

/*
 * What a `dialog` block does in the browser (#254), wired to its root.
 *
 * The server's markup is the whole block: a trigger that is a link to the dialog's id, a closed
 * native `<dialog>` holding the content, and a close link back to the trigger. With no script, or one
 * that never ran, following the link shows the content in the page (see dialog-attrs.ts). This
 * upgrades the links: the trigger opens the dialog as a modal, the close link closes it, a click on
 * the backdrop closes it, Tab stays inside, and focus goes back to the trigger.
 *
 * Escape needs nothing here: a modal `<dialog>` closes on it natively. `showModal` also makes the
 * rest of the page inert, so a screen reader and the pointer stay in the dialog.
 *
 * It is handed nothing and finds its root from a marker it renders, so a page of fifty rows serialises
 * no id. The look check runs the compiled `wireDialog` on a page with no React: see
 * `look/build-dialog-fixture.mjs`, which pastes it in by `toString`. A helper added outside the
 * function has to be pasted there too.
 */
export function wireDialog(root: HTMLElement): (() => void) | undefined {
    const trigger = root.querySelector(`[${DIALOG_OPEN_ATTR}]`);
    const panel = root.querySelector(`[${DIALOG_PANEL_ATTR}]`);
    const closer = root.querySelector(`[${DIALOG_CLOSE_ATTR}]`);
    if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLDialogElement) || !(closer instanceof HTMLElement)) return undefined;
    // A browser that cannot open a modal keeps the links, which still reach the content.
    if (typeof panel.showModal !== "function") return undefined;

    // A plain click only: a new tab, a window or a modified click keeps the link's own meaning.
    const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    const open = (e: MouseEvent) => {
        if (e.defaultPrevented || !plain(e)) return;
        e.preventDefault();
        if (!panel.open) panel.showModal();
    };
    const shut = (e: MouseEvent) => {
        e.preventDefault();
        panel.close();
    };
    // A link that closes is a button now, so it takes Space too.
    const onCloserKey = (e: KeyboardEvent) => {
        if (e.key !== " ") return;
        e.preventDefault();
        closer.click();
    };

    /*
     * The native close event covers Escape, the close control and a call to close() alike. The
     * trigger takes focus back; when it cannot (a row filtered away, a tile re-rendered), the nearest
     * ancestor that is still drawn does, so focus never falls to the body.
     */
    const onClose = () => {
        trigger.focus();
        if (document.activeElement === trigger) return;
        for (let el = root.parentElement; el; el = el.parentElement) {
            if (el.getClientRects().length === 0) continue;
            if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
            el.focus();
            return;
        }
    };

    /*
     * The dialog element is only ever the target of a click that missed its box, because the padding
     * and the look live on the box inside it. Both the press and the release have to be there, so a
     * drag that starts in the text and ends outside it does not close what a reader was selecting.
     */
    let pressedBackdrop = false;
    const onPointerDown = (e: PointerEvent) => {
        pressedBackdrop = e.target === panel;
    };
    const onClick = (e: MouseEvent) => {
        if (e.target === panel && pressedBackdrop) panel.close();
        pressedBackdrop = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;
        const stops = [
            ...panel.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]',
            ),
        ].filter((el) => el.getAttribute("tabindex") !== "-1" && !el.closest("[hidden]") && el.getClientRects().length > 0);
        if (stops.length === 0) {
            e.preventDefault();
            return;
        }
        const first = stops[0];
        const last = stops[stops.length - 1];
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === panel)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && at === last) {
            e.preventDefault();
            first.focus();
        }
    };

    const hadRole = closer.getAttribute("role");
    closer.setAttribute("role", "button");
    trigger.addEventListener("click", open);
    closer.addEventListener("click", shut);
    closer.addEventListener("keydown", onCloserKey);
    panel.addEventListener("close", onClose);
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("click", onClick);
    panel.addEventListener("keydown", onKeyDown);
    return () => {
        trigger.removeEventListener("click", open);
        closer.removeEventListener("click", shut);
        closer.removeEventListener("keydown", onCloserKey);
        panel.removeEventListener("close", onClose);
        panel.removeEventListener("pointerdown", onPointerDown);
        panel.removeEventListener("click", onClick);
        panel.removeEventListener("keydown", onKeyDown);
        if (hadRole === null) closer.removeAttribute("role");
        else closer.setAttribute("role", hadRole);
        if (panel.open) panel.close();
    };
}

export function DialogKeys() {
    const marker = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const root = marker.current?.closest(`[${DIALOG_ATTR}]`);
        if (!(root instanceof HTMLElement)) return;
        return wireDialog(root);
    }, []);

    return <span ref={marker} hidden />;
}
