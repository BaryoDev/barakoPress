/*
 * The attributes the search box writes and its client code reads, in a module with no directive.
 *
 * They lived in search-keys.tsx, which is a "use client" module. A server component importing from
 * one gets a client reference for each export rather than its value, so the box was rendered with
 * none of these attributes and the client code found nothing to wire.
 */

/** The attribute the box marks its root with, so the listeners stay inside one box on a page with two. */
export const SEARCH_ROOT_ATTR = "data-bp-search";
/** Marks an in-page index, and holds how many of its entries show at once. */
export const SEARCH_INDEX_ATTR = "data-bp-search-index";
/** The line an index shows when nothing matched, holding the label it is written from. */
export const SEARCH_EMPTY_ATTR = "data-bp-search-empty";
