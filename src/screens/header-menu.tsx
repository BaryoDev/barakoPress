"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { HeaderAction, SiteLink } from "../config.js";
import { isCurrentLink, isCurrentPath } from "../current-path.js";

/*
 * The parts of the built-in header that follow the path or open and close (#127): a link marked
 * current by its `activeOn`, a link with a dropdown of its children, and the phone menu.
 *
 * A client component because the layout that draws the header is not told the path, and a layout
 * is kept across navigations, so a mark drawn on the server would stay the first page's.
 *
 * Every link is in the server's markup and none needs a script to reach it. Before hydration the
 * header's stylesheet (site-layout.tsx) opens a dropdown on hover and on focus inside it, and the
 * phone menu is a `details` element. The script adds an `aria-expanded` that is true, Escape, and
 * closing when focus leaves.
 *
 * Styles arrive as props, worked out on the server from the theme, so this file names no colour.
 */

export type DropdownEvent =
    | { type: "enter" | "focus" | "toggle" | "escape" }
    | { type: "leave" | "blur"; inside: boolean };

/** Whether a dropdown is open after `event`. `inside` is whether focus is still within it. */
export function dropdownNext(open: boolean, event: DropdownEvent): boolean {
    switch (event.type) {
        case "enter":
        case "focus":
            return true;
        case "toggle":
            return !open;
        case "escape":
            return false;
        case "leave":
        case "blur":
            return event.inside ? open : false;
    }
}

function marked(on: boolean) {
    return on ? ({ "aria-current": "page", className: "bp-current" } as const) : {};
}

function Badge({ text, style }: { text?: string; style: CSSProperties }) {
    return text ? (
        <span data-press="badge" style={style}>
            {text}
        </span>
    ) : null;
}

export interface HeaderLinkStyles {
    link: CSSProperties;
    badge: CSSProperties;
    dropdown: CSSProperties;
    toggle: CSSProperties;
    menu: CSSProperties;
    menuLink: CSSProperties;
}

/** A header link with an `activeOn`, children, or both. A link with neither is drawn by the server. */
export function HeaderLink({ link, styles, submenu }: { link: SiteLink; styles: HeaderLinkStyles; submenu: string }) {
    const pathname = usePathname();
    const anchor = (
        <a href={link.href} {...marked(isCurrentLink(pathname, link))} style={styles.link}>
            {link.label}
            <Badge text={link.badge} style={styles.badge} />
        </a>
    );
    if (!link.children || link.children.length === 0) return anchor;
    return (
        <Dropdown link={link} pathname={pathname} styles={styles} submenu={submenu}>
            {anchor}
        </Dropdown>
    );
}

function Dropdown({
    link,
    pathname,
    styles,
    submenu,
    children,
}: {
    link: SiteLink;
    pathname: string | null;
    styles: HeaderLinkStyles;
    submenu: string;
    children: ReactNode;
}) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    const root = useRef<HTMLSpanElement>(null);
    const toggle = useRef<HTMLButtonElement>(null);
    // Escape hands focus back to the button, and that focus must not open the list again.
    const refocusing = useRef(false);

    useEffect(() => setHydrated(true), []);
    useEffect(() => setOpen(false), [pathname]);

    const send = (event: DropdownEvent) => setOpen((was) => dropdownNext(was, event));
    const inside = (el: EventTarget | null) => el instanceof Node && Boolean(root.current?.contains(el));

    return (
        <span
            ref={root}
            className="bp-dropdown"
            data-js={hydrated ? "" : undefined}
            data-open={open ? "" : undefined}
            style={styles.dropdown}
            onMouseEnter={() => send({ type: "enter" })}
            onMouseLeave={() => send({ type: "leave", inside: inside(document.activeElement) })}
            onFocus={() => {
                if (refocusing.current) refocusing.current = false;
                else send({ type: "focus" });
            }}
            onBlur={(e) => send({ type: "blur", inside: inside(e.relatedTarget) })}
            onKeyDown={(e) => {
                if (e.key !== "Escape" || !open) return;
                e.preventDefault();
                send({ type: "escape" });
                if (document.activeElement !== toggle.current) {
                    refocusing.current = true;
                    toggle.current?.focus();
                }
            }}
        >
            {children}
            <button
                ref={toggle}
                type="button"
                aria-expanded={open}
                aria-controls={id}
                aria-label={submenu.replace("{label}", link.label)}
                style={styles.toggle}
                onClick={() => send({ type: "toggle" })}
            >
                <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10">
                    <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
            </button>
            <ul id={id} style={styles.menu}>
                {(link.children ?? []).map((child) => (
                    <li key={child.href}>
                        <a href={child.href} {...marked(isCurrentPath(pathname, child.activeOn))} style={styles.menuLink}>
                            {child.label}
                            <Badge text={child.badge} style={styles.badge} />
                        </a>
                    </li>
                ))}
            </ul>
        </span>
    );
}

export interface PhoneMenuStyles {
    summary: CSSProperties;
    sheet: CSSProperties;
    list: CSSProperties;
    children: CSSProperties;
    row: CSSProperties;
    badge: CSSProperties;
    actions: CSSProperties;
    action: Record<HeaderAction["variant"], CSSProperties>;
}

export interface PhoneMenuLabels {
    openMenu: string;
    closeMenu: string;
    menu: string;
}

/**
 * The phone menu: a `details` element, so it opens and closes with no script. The header's
 * stylesheet shows it below the breakpoint, in place of the header links and the actions.
 */
export function PhoneMenu({
    links,
    actions,
    feed,
    labels,
    styles,
}: {
    links: SiteLink[];
    actions: HeaderAction[];
    feed?: { label: string; href: string };
    labels: PhoneMenuLabels;
    styles: PhoneMenuStyles;
}) {
    const pathname = usePathname();
    const details = useRef<HTMLDetailsElement>(null);
    const summary = useRef<HTMLElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (details.current) details.current.open = false;
    }, [pathname]);

    const row = (link: SiteLink, on: boolean) => (
        <a data-press="menu-link" href={link.href} {...marked(on)} style={styles.row}>
            {link.label}
            <Badge text={link.badge} style={styles.badge} />
        </a>
    );

    return (
        <details
            className="bp-menu"
            data-press="menu"
            ref={details}
            onToggle={(e) => setOpen(e.currentTarget.open)}
            onKeyDown={(e) => {
                if (e.key !== "Escape" || !details.current?.open) return;
                details.current.open = false;
                summary.current?.focus();
            }}
        >
            <summary ref={summary} aria-label={open ? labels.closeMenu : labels.openMenu} style={styles.summary}>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <rect x="3" y="5" width="18" height="2" rx="1" />
                    <rect x="3" y="11" width="18" height="2" rx="1" />
                    <rect x="3" y="17" width="18" height="2" rx="1" />
                </svg>
            </summary>
            <div style={styles.sheet}>
                {(links.length > 0 || feed) && (
                    <nav aria-label={labels.menu}>
                        <ul style={styles.list}>
                            {links.map((link) => (
                                <li key={link.href}>
                                    {row(link, isCurrentLink(pathname, link))}
                                    {link.children && link.children.length > 0 && (
                                        <ul data-press="menu-children" style={styles.children}>
                                            {link.children.map((child) => (
                                                <li key={child.href}>{row(child, isCurrentPath(pathname, child.activeOn))}</li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                            {feed && (
                                <li>
                                    <a data-press="menu-feed" href={feed.href} style={styles.row}>
                                        {feed.label}
                                    </a>
                                </li>
                            )}
                        </ul>
                    </nav>
                )}
                {actions.length > 0 && (
                    <p style={styles.actions}>
                        {actions.map((action) => (
                            <a key={action.href} href={action.href} data-variant={action.variant} style={styles.action[action.variant]}>
                                {action.label}
                                <Badge text={action.badge} style={styles.badge} />
                            </a>
                        ))}
                    </p>
                )}
            </div>
        </details>
    );
}
