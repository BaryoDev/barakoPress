# barakoPress, built standalone so the runtime image carries a server and not a toolchain.
#
# Next's standalone output traces the files actually imported and copies them, so the final image
# is the server plus the modules it reaches, rather than every dependency in package.json.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci needs a lockfile; fall back so a fresh clone without one still builds.
RUN npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
COPY . .

# One deployment's own files, laid over the reference app.
#
# The app in this repository resolves identity per request: every page lives under
# app/%5Fpress/[site], which only the proxy's rewrite reaches, and the rewrite only fires when the
# config sets `sites`. That is the right default and it is what scripts/two-hosts.sh proves, so it
# stays as it is. A site whose identity is written at build time cannot use it: there is no tenant
# to resolve, so nothing ever rewrites and every page answers 404 while the feed and the sitemap
# still work, which is a confusing way to find out.
#
# Such a site keeps its config and its root routes under deploy/<name>/ and names it here. The
# tenant tree comes out, because its generateStaticParams has no sites to enumerate.
ARG PRESS_DEPLOY=
RUN if [ -n "$PRESS_DEPLOY" ]; then \
      test -d "deploy/$PRESS_DEPLOY" || { echo "deploy/$PRESS_DEPLOY is not in the build context"; exit 1; }; \
      rm -rf "app/%5Fpress"; \
      cp -R "deploy/$PRESS_DEPLOY/." .; \
    fi

# The build renders nothing from the CMS: every page is dynamic or revalidated at runtime, so no
# CMS_URL is needed here and the image is not tied to one instance.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Runs as a non-root user. The image needs no write access to its own files at runtime; the cache
# Next writes lives under .next/cache, which is created and owned below.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next

USER nextjs
EXPOSE 3000

# No shell form: the server should be PID 1 so a stop signal reaches it rather than a shell.
CMD ["node", "server.js"]
