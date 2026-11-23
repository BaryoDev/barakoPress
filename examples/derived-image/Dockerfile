# A derived image from the published engine source, with no checkout of barakoPress (#166).
#
# Blocks are registered when the Next build runs, so a plugin cannot be added to the built image.
# The source image holds the engine's source and installed dependencies, unbuilt, and is published
# for every release as ghcr.io/baryodev/barako-press-source:<version>. This file lays a site's
# plugins and overlay over it, builds, and ends in the same runtime stage as the engine's Dockerfile.
#
#   docker buildx build --build-arg PRESS_VERSION=0.14.1 -t my-press:0.14.1 .
#
# ./plugins holds `npm pack` tarballs with each plugin's dependencies in bundleDependencies, since the
# install runs offline. ./overlay holds the site's own files, laid over the reference app. Either may
# be empty. Pin the version, and rebuild and check the plugins when you move it.
ARG PRESS_VERSION
FROM ghcr.io/baryodev/barako-press-source:${PRESS_VERSION} AS build

COPY overlay/ /overlay/
COPY plugins/ /plugins/

# The same steps the engine's Dockerfile runs. An overlay that ships its own app/%5Fpress replaces
# the reference tree; any other overlay loses the tenant tree.
RUN rm -f /overlay/.gitkeep; \
    if [ -n "$(ls -A /overlay)" ]; then \
      rm -rf "app/%5Fpress"; \
      cp -R /overlay/. .; \
    fi; \
    rm -rf /overlay
RUN node scripts/plugins.mjs /plugins && rm -rf /plugins

ARG PRESS_TRAILING_SLASH=
ENV PRESS_TRAILING_SLASH=$PRESS_TRAILING_SLASH

# A path prefix, such as /kape-ana, for a site served behind a proxy under that path. Next reads
# basePath at build time, so it is a build argument. It is set again in the run stage below.
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS run
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

# Asks the server for its own home page, under BASE_PATH when one is set, and passes on any status
# under 500. A container answering for several sites has no tenant for 127.0.0.1, so the proxy
# answers 404 there, and that is still a server that is up. Node is already in the image, so this
# adds no curl or wget. Same command and timings as the site service in compose.yml.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000'+('/'+(process.env.BASE_PATH||'').trim().split('/').filter(Boolean).join('/')+'/').replace('//','/')).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]

# No shell form: the server should be PID 1 so a stop signal reaches it rather than a shell.
CMD ["node", "server.js"]
