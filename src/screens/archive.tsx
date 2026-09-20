import { notFound } from "next/navigation";
import { POST_COLLECTION, type PressConfig } from "../config.js";
import { createCollectionDetail, createCollectionStaticParams } from "./collection.js";

/*
 * Posts by author, or by category: the detail page of the author or category collection, listing the
 * posts whose reference points at it.
 *
 * `which` is the collection's key. A site with no author type has no author collection, so the route
 * is a 404 if mounted anyway, and a site with the type but no reference field to filter on is too.
 */
/**
 * @deprecated Since 0.7.0. Use `createCollectionDetail(config, "author", { related: { collection:
 * "post", via } })`, which is what this calls. Removed no earlier than 1.0.0.
 */
export function createArchive(base: PressConfig, which: "author" | "category") {
    const via = base.fields[which];
    return createCollectionDetail(
        base,
        which,
        via ? { related: { collection: POST_COLLECTION, via } } : { related: false, view: () => notFound() },
    );
}

/** Slugs for a static export of an archive route. */
export function createArchiveStaticParams(config: PressConfig, which: "author" | "category") {
    return createCollectionStaticParams(config, which);
}
