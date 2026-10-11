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
RUN npm run build

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
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
