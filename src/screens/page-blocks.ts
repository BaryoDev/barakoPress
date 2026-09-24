import type { PressConfig } from "../config.js";
import type { Page } from "../cms.js";
import { resolveBlocks, type BlockRegistry, type ResolvedBlock } from "../blocks/schema.js";
import { bindBlocks, pageScope, queryScope, siteScope } from "../blocks/bind.js";
import { getGlobals } from "../site.js";

/*
 * Apart from the page screen so a collection index can render its `indexPage` (#126): the page
 * screen imports the collection screens, so the collection screens cannot import it back.
 */

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * A page's blocks: resolved against the registry, then bound and expanded.
 *
 * Every scope is a thunk, so a page that binds nothing reads nothing. That matters for `site`,
 * which is a CMS read, and for `query`, which makes the route dynamic.
 */
export async function pageBlocks(
    config: PressConfig,
    page: Page,
    registry: BlockRegistry,
    options: { perViewer?: boolean; searchParams?: SearchParams; scope?: string } = {},
): Promise<ResolvedBlock[]> {
    if (!Array.isArray(page.blocks) || page.blocks.length === 0) return [];
    const blocks = resolveBlocks(page.blocks, registry, { perViewer: options.perViewer === true });
    return bindBlocks(blocks, {
        config,
        registry,
        scope: options.scope,
        scopes: {
            site: async () => siteScope(config, await getGlobals(config)),
            page: () => pageScope(page),
            ...(options.searchParams ? { query: async () => queryScope(await options.searchParams!) } : {}),
        },
        // Reported, never thrown, and never shown to a visitor: a renamed field is something the
        // person editing the page has to see, and nothing a reader can act on. Where they see it is
        // barakoBrew, over `createBindingReportRoute`; this line is for whoever has the log.
        onProblem: (problem) =>
            console.warn(
                `blocks: ${problem.binding} on page "${page.slug || page.id}" is ${problem.reason}` +
                    (problem.block ? ` (${problem.block}.${problem.field})` : ""),
            ),
    });
}
