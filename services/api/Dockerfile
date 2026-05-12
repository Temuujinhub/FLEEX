# Multi-stage build for the Fleex API. Produces a small node:alpine image
# that runs Prisma migrations on startup and then serves Nest.

FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps

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
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
