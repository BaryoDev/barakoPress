import { createBlockRegistry, defineConfig } from "barakopress";

/*
 * The reference deployment's configuration, and the image built from it carries no site.
 *
 * `sites` turns on request-time identity (barakoCMS D22): the host a request came to is resolved to
 * a tenant through the CMS, and that tenant's `site` settings entry supplies the name, the palette,
 * the faces, the header and the footer. One container answers every domain the CMS knows. What stays
 * in the environment is per deployment only: CMS_URL, REVALIDATE_SECRET, and optionally CMS_TENANT
 * to pin the container to one tenant or CMS_DEFAULT_TENANT for a host that has no tenant.
 *
 * A site that wants identity written here instead leaves `sites` out and passes `site`, as
 * barakocms.com does. That is a build-time site, and it behaves exactly as it did before this.
 *
 * `pages: ""` mounts the Pages module's page tree at the site root: app/[...path] renders the page at
 * each path, and the layout draws each tenant's menu in its header. The blog index keeps `/`.
 *
 * A site using the `blog` blueprint unchanged needs nothing else. Everything else defaults to what
 * `POST /api/content-types/blueprints/blog` creates: the types post, author and category, the
 * PascalCase field names, and routes at /blog, /authors and /categories.
 */
export const config = defineConfig({
  sites: {},
  pages: "",
});

/*
 * The blocks this site's pages can hold: the built-ins, and any the site adds as a second argument.
 * app/api/blocks publishes the same registry, so an editor offers exactly what renders here.
 */
export const blocks = createBlockRegistry(config);
