"use client";

import { useEffect, useRef } from "react";
import { DIALOG_ATTR, DIALOG_INLINE_ATTR, DIALOG_OPEN_ATTR, DIALOG_PANEL_ATTR } from "./dialog-attrs.js";

/*
 * What a `dialog` block does in the browser (#254), wired to its root.
 *
 * The server's markup is the whole block: a closed native `<dialog>` holding the content, a trigger
 * put away until now, and a form with `method="dialog"` as the close button. A browser with no
 * script is shown the content in the page by the stylesheet. This adds what a form cannot do:
 * open the dialog as a modal, close it on a click on the backdrop, keep Tab inside it, and give
 * focus back to the trigger.
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
    if (!(trigger instanceof HTMLButtonElement) || !(panel instanceof HTMLDialogElement)) return undefined;

    // A browser that cannot open a modal gets the content in the page, as with no script.
    if (typeof panel.showModal !== "function") {
        root.setAttribute(DIALOG_INLINE_ATTR, "");
        return () => root.removeAttribute(DIALOG_INLINE_ATTR);
    }

    const open = () => {
        if (!panel.open) panel.showModal();
    };
    // The native close event covers Escape, the close button and a call to close() alike.
    const onClose = () => trigger.focus();

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
                'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
            ),
        ].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
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

    trigger.hidden = false;
    trigger.addEventListener("click", open);
    panel.addEventListener("close", onClose);
    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("click", onClick);
    panel.addEventListener("keydown", onKeyDown);
    return () => {
        trigger.removeEventListener("click", open);
        panel.removeEventListener("close", onClose);
        panel.removeEventListener("pointerdown", onPointerDown);
        panel.removeEventListener("click", onClick);
        panel.removeEventListener("keydown", onKeyDown);
        if (panel.open) panel.close();
        trigger.hidden = true;
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
