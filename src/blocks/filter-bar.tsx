"use client";

import { useState, type CSSProperties } from "react";
import { FILTER_CHOSEN_ATTR, filterRule } from "./filter.js";

/*
 * The buttons of a `filterBar`. It is handed the bar's id and its values, never the rows: the rows
 * are already in the page as markup, and a client component's props are serialised into it.
 *
 * Buttons with `aria-pressed`, not a tablist. The tab pattern promises arrow keys and panels, and
 * this is a set of toggles over one list.
 *
 * At rest nothing is chosen and no rule is written, so a reader with no script sees every row.
 */

/** A look: the inline style, and the classes a style recipe brings with it. */
export interface FilterLook {
    style: CSSProperties;
    className?: string;
}

export interface FilterButtonsProps {
    id: string;
    values: string[];
    allLabel: string;
    label?: string;
    on: FilterLook;
    off: FilterLook;
    row: FilterLook;
}

export function FilterButtons({ id, values, allLabel, label, on, off, row }: FilterButtonsProps) {
    const [picked, setChosen] = useState<string | null>(null);
    // The bar can stay mounted across a navigation that changes the rows, and a value the new rows
    // do not hold would hide every one of them with no button pressed.
    const chosen = picked !== null && values.includes(picked) ? picked : null;
    const button = (value: string | null, text: string) => (
        <button
            key={value ?? ""}
            type="button"
            aria-pressed={chosen === value}
            style={chosen === value ? on.style : off.style}
            className={(chosen === value ? on.className : off.className) || undefined}
            onClick={() => setChosen(value)}
        >
            {text}
        </button>
    );
    const chosenAttr = chosen === null ? {} : { [FILTER_CHOSEN_ATTR]: chosen };
    return (
        <div role="group" aria-label={label} style={row.style} className={row.className || undefined} {...chosenAttr}>
            {button(null, allLabel)}
            {values.map((value) => button(value, value))}
            {chosen !== null && <style dangerouslySetInnerHTML={{ __html: filterRule(id, chosen) }} />}
        </div>
    );
}
