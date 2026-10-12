"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/*
 * The copy affordance on a `codeSample` (#82).
 *
 * Until it has hydrated, and wherever there is no clipboard API, it is the tenant's word as plain
 * text and the snippet below is selected whole by one click, which is what the block always did. A
 * button is drawn only once a script is there to make it do something, so nobody is shown a control
 * that does nothing. If writing to the clipboard fails, the snippet is selected instead, so the
 * visitor is one keystroke from what they asked for.
 *
 * Handed the word and its look, never the snippet: the snippet is already in the page, and a client
 * component's props are serialised into it a second time.
 */

const SHOWN_MS = 2000;

export interface CopyButtonProps {
    label: string;
    /** Said in place of the label once the snippet is on the clipboard, and announced. */
    copiedLabel?: string;
    style: CSSProperties;
}

/** The `pre` of the sample this sits in: the label's row and the snippet share one parent. */
function snippetOf(el: HTMLElement | null): HTMLPreElement | null {
    return el?.parentElement?.parentElement?.querySelector("pre") ?? null;
}

function select(pre: HTMLPreElement) {
    const range = document.createRange();
    range.selectNodeContents(pre);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
}

/** Whether a button can do what it says: a clipboard that takes text. */
export function canCopy(nav: { clipboard?: { writeText?: unknown } } | undefined): boolean {
    return typeof nav?.clipboard?.writeText === "function";
}

/**
 * Puts `text` on the clipboard, or calls `fallback` when that is refused (no permission, an insecure
 * page, a document without focus). Says which happened.
 */
export async function copyOrSelect(
    text: string,
    clipboard: { writeText(text: string): Promise<void> },
    fallback: () => void,
): Promise<"copied" | "selected"> {
    try {
        await clipboard.writeText(text);
        return "copied";
    } catch {
        fallback();
        return "selected";
    }
}

export function CopyButton({ label, copiedLabel, style }: CopyButtonProps) {
    const [ready, setReady] = useState(false);
    const [copied, setCopied] = useState(false);
    const self = useRef<HTMLSpanElement>(null);

    useEffect(() => setReady(canCopy(typeof navigator === "undefined" ? undefined : navigator)), []);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), SHOWN_MS);
        return () => clearTimeout(timer);
    }, [copied]);

    if (!ready) return <span ref={self}>{label}</span>;

    const copy = async () => {
        const pre = snippetOf(self.current);
        if (!pre) return;
        const done = await copyOrSelect(pre.textContent ?? "", navigator.clipboard, () => select(pre));
        setCopied(done === "copied");
    };

    return (
        <span ref={self}>
            <button type="button" onClick={copy} style={style}>
                {copied && copiedLabel ? copiedLabel : label}
            </button>
            {copiedLabel && (
                <span role="status" style={HIDDEN}>
                    {copied ? copiedLabel : ""}
                </span>
            )}
        </span>
    );
}

/** Read and not seen: the button already shows the word. */
const HIDDEN: CSSProperties = {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "-1px",
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    border: 0,
};
