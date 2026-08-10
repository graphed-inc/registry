# syntax=docker/dockerfile:1

# Single image builds both the dashboard service and the cron jobs.
# `graphed deploy` uploads this repo and builds this Dockerfile; the manifest
# (graphed.yaml) decides which commands run as services vs jobs.

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
# Reproducible install when a lockfile is committed; plain install otherwise.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run -w @app/dashboard build
# Next's build cache is large and useless at runtime; drop it so the runner
# stage below stays lean.
RUN rm -rf packages/dashboard/.next/cache

# Drop devDependencies (types, typescript) from the tree the runner copies.
# tsx is a runtime dependency (jobs and the migrate release command run
# through it), so it survives the prune.
RUN npm prune --omit=dev

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Ship the whole build stage. Plugins extend the scaffold with root-level
# paths beyond packages/ (graphed.yaml for projectRoot(), clients/ for
# per-client plugin config, ...), so an allowlist of COPY paths breaks in
# cloud while working locally. .dockerignore is the denylist for what enters
# the image — keep secret-bearing files listed there.
COPY --from=build /app ./

# Next's standalone output does not include static assets or public/; the
# standalone server only serves them from inside its own tree.
COPY --from=build /app/packages/dashboard/.next/static ./packages/dashboard/.next/standalone/packages/dashboard/.next/static
COPY --from=build /app/packages/dashboard/public ./packages/dashboard/.next/standalone/packages/dashboard/public

# The manifest's services.dashboard.command runs this same entrypoint.
CMD ["node", "packages/dashboard/.next/standalone/packages/dashboard/server.js"]
