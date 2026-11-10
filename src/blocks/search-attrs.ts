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
/** Marks the container of a grouped search's product groups. */
export const SEARCH_GROUPS_ATTR = "data-bp-search-groups";
/** Marks one product group, and holds its product key. */
export const SEARCH_GROUP_ATTR = "data-bp-search-group";
/** The line a group shows when nothing in it matched. */
export const SEARCH_GROUP_EMPTY_ATTR = "data-bp-search-group-empty";
/** The marker for a live count of what a grouped search matched, holding the label it is written from. */
export const SEARCH_COUNT_ATTR = "data-bp-search-count";

/** Lowercased with accents removed, so "cafe" finds "Café" on the server and in the browser alike. */
export function foldText(text: string): string {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** The most characters of a query anything here reads. */
export const MAX_QUERY = 200;
