import { timingSafeEqual } from "node:crypto";
import { pinnedTenant, type PressConfig } from "../config.js";
import { getPage, getPageAtPath, type Page } from "../cms.js";
import { bindBlocks, pageScope, queryScope, siteScope } from "../blocks/bind.js";
import { registryFor } from "../blocks/registry.js";
import { resolveBlocks, type BlockRegistry } from "../blocks/schema.js";
import type { BindingProblem } from "../blocks/bindings.js";
import { bindingsKeyFor } from "../revalidate-key.js";
import { readEnv } from "../env.js";
import { MIN_SECRET_LENGTH, readSecret, type PressSecret } from "../secret.js";
import { getGlobals, siteConfigOrNull } from "../site.js";
import { parseOrigins, type BlockSchemaRouteOptions } from "./block-schema.js";

/*
 * Why a binding did not resolve, for the person who typed it (#63).
 *
 * The three reasons were already worked out where a page binds: `unknown scope` for a word that is
 * no scope, `unbound scope` for a real one this page does not carry, `no value` for a scope that is
 * there and a path in it that is not. They went to the server log, so the person who can read them
 * is not the person who made the mistake, and the page renders with the placeholder left as typed
 * or the block quietly dropped. For a product whose promise is that a site is configured rather
 * than coded, that is the wrong way round.
 *
 * Two things the issue left to settle, and what they are:
 *
 * Rendered, not stored. The page is resolved and bound exactly as `createPage` binds it, so an
 * `{{item.X}}` outside a repeat reports as an unbound scope. Reading the stored blocks would catch
 * a typo and miss that one entirely, and a scope that is not in hand is the case an editor is least
 * able to work out from the page.
 *
 * Gated, on any page. A report names field paths, and those are not a visitor's to read, so it is
 * never anonymous. The key is derived per tenant from PRESS_SECRET under its own purpose label, so
 * the key that reads one tenant's problems reads no other tenant's and cannot purge anything. An
 * operator prints it with `barakopress bindings-key <tenant>`.
 *
 * The query is off unless the page route has it on. `createPage` hands blocks the request's query
 * only when it is mounted with `{ query: true }`, so a report that always supplied one would resolve
 * a `{{query.X}}` the visitor's page leaves unbound, and say a binding works where it does not. A
 * report that lies in that direction is worse than no report, so this takes the same option and
 * defaults it the same way the page route's own default works out for a kept route.
 *
 * Nothing here changes what a visitor gets. The page is bound a second time, for this caller, and
 * the answer is never cached.
 */

export interface BindingReportOptions extends BlockSchemaRouteOptions {
    /** Defaults to PRESS_SECRET. A request-time site derives each tenant's key from it. */
    secret?: string;
    /**
     * Whether the page being reported on is mounted with `createPage(config, blocks, { query: true })`.
     * Off by default, which is what a page route without it does: a `{{query.X}}` on such a page is
     * an unbound scope for every visitor, and the report has to say so. On, the report's own query
     * string past `path` and `slug` is what the bindings read.
     */
    query?: boolean;
    /** The most problems one answer spells out. */
    maxProblems?: number;
}

const MAX_PROBLEMS = 200;

export interface BindingReport {
    page: { id: string; slug: string; title: string };
    problems: BindingProblem[];
    /** True when the page had more problems than the answer carries. */
    truncated: boolean;
}

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } as const;

function headersFor(origin: string | null): Headers {
    const headers = new Headers({ ...NO_STORE, vary: "Origin, Authorization" });
    if (origin) {
        headers.set("access-control-allow-origin", origin);
        headers.set("access-control-allow-credentials", "true");
    }
    return headers;
}

function allowedOrigin(request: Request, options: BindingReportOptions): string | null {
    const origin = request.headers.get("origin");
    if (!origin) return null;
    return parseOrigins(options.consoleOrigins ?? readEnv().consoleOrigins).includes(origin) ? origin : null;
}

/** The secret this route verifies with, read when called rather than at module scope. */
function configuredSecret(option: string | undefined): PressSecret | null {
    if (option === undefined) return readSecret("bindings");
    return option ? { value: option, name: "the secret option", short: option.length < MIN_SECRET_LENGTH } : null;
}

/** Constant-time compare that does not leak length through an early return either. */
function sameKey(a: string, b: string): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
}

function bearer(request: Request): string {
    const value = request.headers.get("authorization") ?? "";
    const match = value.match(/^Bearer[ ]+(.+)$/i);
    return match ? match[1].trim() : "";
}

/** The key this config's caller has to present: the tenant's own, or the secret on a pinned site. */
function expectedKey(config: PressConfig, secret: string): string {
    const tenant = pinnedTenant(config);
    return tenant ? bindingsKeyFor(secret, tenant) : secret;
}

/*
 * The query a reported page binds against, when the page route reads one at all.
 *
 * `path` and `slug` address the page and are this route's own, so they are taken out. Everything
 * else is handed to `{{query.X}}`, which is how a console asks what the page does with a given
 * value.
 */
function reportQuery(url: URL): Record<string, string> {
    const params = new URLSearchParams(url.searchParams);
    params.delete("path");
    params.delete("slug");
    return queryScope(params);
}

async function findPage(config: PressConfig, url: URL): Promise<Page | null> {
    const slug = url.searchParams.get("slug");
    if (slug) return getPage(config, slug);
    const path = url.searchParams.get("path");
    if (!path || !path.startsWith("/")) return null;
    return getPageAtPath(config, path);
}

/**
 * The binding problems on one page of one tenant, for barakoBrew.
 *
 * Mount it beside the block schema route, with the same registry the page route renders with, so
 * what is reported is what a visitor's page would do.
 */
export function createBindingReportRoute(
    base: PressConfig,
    registry: BlockRegistry,
    options: BindingReportOptions = {},
) {
    const limit = options.maxProblems ?? MAX_PROBLEMS;

    return async function GET(request: Request): Promise<Response> {
        const origin = allowedOrigin(request, options);
        const headers = headersFor(origin);
        const refuse = (status: number, error: string) => Response.json({ error }, { status, headers });

        const found = configuredSecret(options.secret);
        if (!found || found.short) {
            // Refused rather than left open. A report names every field path on the page.
            console.error(
                `bindings: no secret of at least ${MIN_SECRET_LENGTH} characters is configured, refusing every binding report`,
            );
            return refuse(503, "not configured");
        }

        const config = await siteConfigOrNull(base);
        if (!config) return refuse(404, "no site");

        const presented = bearer(request);
        if (!presented || !sameKey(presented, expectedKey(config, found.value))) return refuse(401, "unauthorised");

        const url = new URL(request.url);
        const page = await findPage(config, url);
        if (!page) return refuse(404, "no page");

        const blocks = registryFor(config, registry);
        const resolved = resolveBlocks(page.blocks, blocks, { perViewer: true });
        const problems: BindingProblem[] = [];
        let seen = 0;
        await bindBlocks(resolved, {
            config,
            registry: blocks,
            scopes: {
                site: async () => siteScope(config, await getGlobals(config)),
                page: () => pageScope(page),
                ...(options.query === true ? { query: () => reportQuery(url) } : {}),
            },
            onProblem: (problem) => {
                seen++;
                if (problems.length < limit) problems.push(problem);
            },
        });

        const report: BindingReport = {
            page: { id: page.id, slug: page.slug, title: page.title },
            problems,
            truncated: seen > problems.length,
        };
        return Response.json(report, { headers });
    };
}

/** The preflight for the report route. Mount it as `OPTIONS` beside the route. */
export function createBindingReportPreflight(options: BindingReportOptions = {}) {
    return function OPTIONS(request: Request): Response {
        const origin = allowedOrigin(request, options);
        const headers = headersFor(origin);
        if (origin) {
            headers.set("access-control-allow-methods", "GET, OPTIONS");
            headers.set("access-control-allow-headers", "Accept, Authorization, Content-Type");
            headers.set("access-control-max-age", "600");
        }
        return new Response(null, { status: 204, headers });
    };
}
