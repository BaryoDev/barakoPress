import { POST_COLLECTION, type PressConfig } from "../config.js";
import { createCollectionIndex } from "./collection.js";

/*
 * The post list: the index of the post collection, which `defineConfig` derives from `types`, `fields`
 * and `routes`. A factory rather than a component, because a Next route is a file and a package cannot
 * write files into someone else's app. The consumer's page.tsx is:
 *
 *     import { createBlogIndex } from "barakopress";
 *     import { config } from "@/press.config";
 *     export default createBlogIndex(config);
 *     export const revalidate = 300;
 *
 * `Card` lives with the collection screens and still takes a `post`, so a site that wants its own list
 * but the engine's card keeps importing it from here.
 */

export { Card } from "./collection.js";

export function createBlogIndex(config: PressConfig) {
    return createCollectionIndex(config, POST_COLLECTION);
}
