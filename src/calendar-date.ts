const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The zone to format a value in. A bare YYYY-MM-DD names a calendar day, not an instant, and it
 * parses as UTC midnight, so it is formatted in UTC or a western site zone would print the day
 * before. A value with a time part is an instant and keeps the site zone.
 */
export function zoneFor(value: unknown, siteZone: string | undefined): string | undefined {
    return typeof value === "string" && BARE_DATE.test(value.trim()) ? "UTC" : siteZone;
}
