# Multi-stage build for the Fleex API. Produces a small node:alpine image
# that runs Prisma migrations on startup and then serves Nest.

FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json ./
# npm ci (audit M6): reproducible, integrity-checked install from the lockfile;
# fails on lock/package.json drift instead of silently resolving new versions.
RUN npm ci --no-audit --no-fund --legacy-peer-deps

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npx nest build

# Drop dev deps from node_modules to shrink the runtime image.
RUN npm prune --production --legacy-peer-deps

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl tini wget && \
    addgroup -S fleex && adduser -S fleex -G fleex

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

USER fleex
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# `prisma db push` syncs schema.prisma to the database (creates/updates
# every relational table). It's idempotent and safe to re-run. The
# TimescaleDB-specific DDL (hypertable, retention) runs inside the app on
# startup via TimescaleInitService.
# Use the local prisma binary explicitly so npx never tries to fetch a
# newer release from npm (Prisma 7 changed the schema syntax and would
# blow up against our 5.x schema).
#
# db push failures no longer abort the boot. A schema drift used to lock
# the API in a restart loop (Prisma kept trying to DROP the `positions`
# hypertable because the continuous aggregate's dependent views blocked
# it). The relational schema is stable in production; if a real
# migration is needed, run `prisma db push` manually with eyes on.
#
# --accept-data-loss is GATED behind PRISMA_DB_PUSH_ACCEPT_DATA_LOSS
# (default off, audit H7). By default db push runs WITHOUT it, so a schema
# drift that would DROP a column/table is refused (the `||` branch keeps the
# existing schema and boots) instead of silently destroying production data.
# Only set the flag true for an intentional, backed-up destructive sync.
CMD ["sh", "-c", "FLAGS=''; [ \"$PRISMA_DB_PUSH_ACCEPT_DATA_LOSS\" = 'true' ] && { echo '[entrypoint] WARNING: --accept-data-loss enabled — destructive schema sync'; FLAGS='--accept-data-loss'; }; ./node_modules/.bin/prisma db push $FLAGS --schema=prisma/schema.prisma || echo '[entrypoint] WARNING: prisma db push failed; booting with existing DB schema'; exec node dist/main.js"]
