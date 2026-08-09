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
RUN npm install

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run -w @app/dashboard build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Jobs run from source via tsx (hoisted into the root node_modules).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/jobs ./packages/jobs

# Next.js standalone output (server.js + traced node_modules) plus static assets.
COPY --from=build /app/packages/dashboard/.next/standalone ./packages/dashboard/.next/standalone
COPY --from=build /app/packages/dashboard/.next/static ./packages/dashboard/.next/standalone/packages/dashboard/.next/static
COPY --from=build /app/packages/dashboard/public ./packages/dashboard/.next/standalone/packages/dashboard/public

# The manifest's services.dashboard.command runs this same entrypoint.
CMD ["node", "packages/dashboard/.next/standalone/packages/dashboard/server.js"]
