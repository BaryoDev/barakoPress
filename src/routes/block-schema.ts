import { blockSchema, type BlockRegistry } from "../blocks/schema.js";

/*
 * Publishes what this site can render, so an editor can offer exactly these blocks and these
 * fields without knowing anything about the site. It reads no CMS and holds nothing secret: the
 * field lists are already visible in any page's markup.
 */
export function createBlockSchemaRoute(registry: BlockRegistry) {
    return function GET(): Response {
        return Response.json(blockSchema(registry));
    };
}
