# barakoPress, built standalone so the runtime image carries a server and not a toolchain.
#
# Next's standalone output traces the files actually imported and copies them, so the final image
# is the server plus the modules it reaches, rather than every dependency in package.json.

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci needs a lockfile; fall back so a fresh clone without one still builds.
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Empty unless the build names a context for it: `--build-context overlay=<dir>` replaces this stage.
# That is how a site keeps its theme in its own repository and still builds the published engine.
FROM scratch AS overlay

# Empty unless the build names a context for it: `--build-context plugins=<dir>` replaces this stage.
# The directory holds `npm pack` tarballs of plugin packages. See "Plugin packages" in the README.
FROM scratch AS plugins

# The engine's source with its dependencies installed and nothing built. It is published as
# ghcr.io/baryodev/barako-press-source:<version> so a site can build a derived image with a plugin or
# an overlay from `FROM` that tag, with no checkout of this repository. See examples/derived-image.
FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS source
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
COPY . .

FROM source AS build
COPY --from=overlay / /overlay/
COPY --from=plugins / /plugins/

# One deployment's own files, laid over the reference app.
#
# The app in this repository resolves identity per request: every page lives under
# app/%5Fpress/[site], which only the proxy's rewrite reaches, and the rewrite only fires when the
# config sets `sites`. That is the right default and it is what scripts/two-hosts.sh proves, so it
# stays as it is. A site whose identity is written at build time cannot use it: there is no tenant
# to resolve, so nothing ever rewrites and every page answers 404 while the feed and the sitemap
# still work, which is a confusing way to find out.
#
# Such a site keeps its config and its root routes under deploy/<name>/ and names it here, or passes
# the directory as the `overlay` build context. An overlay that ships its own app/%5Fpress is a
# request-time site with its own layout and routes, so its tree replaces the reference one. Any other
# overlay loses the tenant tree, because its generateStaticParams has no sites to enumerate.
ARG PRESS_DEPLOY=
RUN if [ -n "$(ls -A /overlay)" ]; then \
      source=/overlay; \
    elif [ -n "$PRESS_DEPLOY" ]; then \
      test -d "deploy/$PRESS_DEPLOY" || { echo "deploy/$PRESS_DEPLOY is not in the build context"; exit 1; }; \
      source="deploy/$PRESS_DEPLOY"; \
    fi; \
    if [ -n "$source" ]; then \
      rm -rf "app/%5Fpress"; \
      cp -R "$source/." .; \
    fi; \
    rm -rf /overlay

# After the overlay, so an overlay's own press.config.ts registers the plugins too: it imports
# `plugins` from press.plugins.ts the way the reference one does. With no tarballs this changes nothing.
RUN node scripts/plugins.mjs /plugins && rm -rf /plugins

# barakocms.com's URLs end in a slash. Set here rather than by an overlay's own next.config.ts, which
# would be a site owning a file the engine's build depends on.
ARG PRESS_TRAILING_SLASH=
ENV PRESS_TRAILING_SLASH=$PRESS_TRAILING_SLASH

# A path prefix, such as /kape-ana, for a site served behind a proxy under that path. Next reads
# basePath at build time, so it is a build argument. It is set again in the run stage below.
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH

# The build renders nothing from the CMS: every page is dynamic or revalidated at runtime, so no
# CMS_URL is needed here and the image is not tied to one instance.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26.13.0-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH

# Runs as a non-root user. The image needs no write access to its own files at runtime; the cache
# Next writes lives under .next/cache, which is created and owned below.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# The server never runs npm or corepack, so they are not in the final image. npm ships its own copy of
# brace-expansion, pacote, picomatch and other packages, and a scan of the image reports those as the
# image's own. The source stage above keeps npm because it installs and builds.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs
EXPOSE 3000

# Asks the server for /api/health, under BASE_PATH when one is set, and passes on any status under
# 500. The proxy never rewrites /api, so the check renders no page. A check of the home page rendered
# it before barakoCMS served the tenant, and Next served that 404 from cache to every visitor after.
# Node is already in the image, so this adds no curl or wget. Same command and timings as the site
# service in compose.yml.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000'+('/'+(process.env.BASE_PATH||'').trim().split('/').filter(Boolean).join('/')+'/api/health').replace('//','/')).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]

# No shell form: the server should be PID 1 so a stop signal reaches it rather than a shell.
CMD ["node", "server.js"]
