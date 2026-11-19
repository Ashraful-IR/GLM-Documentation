# syntax=docker/dockerfile:1

# --- deps ---------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# --- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time DB access: all pages/APIs are server-rendered dynamically
# (verified: no static prerendering touches PostgreSQL), so `next build`
# needs no DATABASE_URL and no network access to any database.
RUN npm run build && npm run build:deploy

# --- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs \
 && mkdir -p /app/uploads && chown -R nextjs:nextjs /app
COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nextjs /app/public ./public
# Deploy step: self-contained bundle (src/db/deploy.ts) + the SQL migrations.
COPY --from=build --chown=nextjs:nextjs /app/dist/deploy.mjs ./deploy.mjs
COPY --from=build --chown=nextjs:nextjs /app/drizzle ./drizzle
USER nextjs
EXPOSE 3000
# On every start: migrate, add starter lists if empty, bootstrap the admin from
# ADMIN_EMAIL / ADMIN_PASSWORD if missing — then start the app. If the deploy
# step fails the container exits instead of serving on an outdated schema.
# Set RUN_MIGRATIONS=false to skip it.
CMD ["sh", "-c", "node deploy.mjs && exec node server.js"]
