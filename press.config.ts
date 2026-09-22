import { createBlockRegistry, defineConfig } from "barakopress";

/*
 * The reference deployment's configuration.
 *
 * Two identities are possible and the choice is not cosmetic.
 *
 * `sites` turns on request-time identity (barakoCMS D22): the host a request came to is resolved to
 * a tenant through the CMS, and that tenant's `site` settings entry supplies the name, the palette,
 * the faces, the header and the footer. One container answers every domain the CMS knows. What stays
 * in the environment is per deployment only: CMS_URL, PRESS_SECRET, and optionally CMS_TENANT
 * to pin the container to one tenant or CMS_DEFAULT_TENANT for a host that has no tenant.
 *
 * `site` is the other one, written here at build time, which is what barakocms.com does.
 *
 * This deployment uses `site`, and the reason is worth recording because the failure it causes is
 * silent. Request-time identity resolves the host through `GET /api/tenants/by-host/{host}`, and a
 * CMS with no tenants has nothing to resolve to, so every route answers 404: not an error page, the
 * ordinary "this page could not be found". The site looks broken and the deployment is fine. If this
 * CMS gains tenants, swapping back is deleting `site` and restoring `sites: {}`.
 *
 * `pages: ""` mounts the Pages module's page tree at the site root: app/[...path] renders the page at
 * each path, and the layout draws the menu in its header. The blog index keeps `/`.
 *
 * A site using the `blog` blueprint unchanged needs nothing else. Everything else defaults to what
 * `POST /api/content-types/blueprints/blog` creates: the types post, author and category, the
 * PascalCase field names, and routes at /blog, /authors and /categories.
 */
export const config = defineConfig({
    // Literals, not process.env. A value read at module scope is baked into the prerender at build
    // time, which is how a client's masthead once said "barakoPress" until something revalidated it.
    // Only per-environment values (CMS_URL, PRESS_SECRET, CMS_TENANT) come from the environment.
    site: {
        name: "barakoPress",
        tagline: "A blog on barakoCMS",
        url: "https://press.baryo.dev",
    },
    pages: "",
});

/*
 * The blocks this site's pages can hold: the built-ins, and any the site adds as a second argument.
 * app/api/blocks publishes the same registry, so an editor offers exactly what renders here.
 */
export const blocks = createBlockRegistry(config);
