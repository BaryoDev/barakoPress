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
