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
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.23.4-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
