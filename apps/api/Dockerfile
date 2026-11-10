# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/api/Dockerfile -t fld-cms-api .

ARG NODE_VERSION=24

# TypeScript compiles once, on the builder's own platform; its output runs on any.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @fld/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @fld/shared build \
 && pnpm --filter @fld/api db:generate \
 && pnpm --filter @fld/api build

# Production dependencies install on the image's own platform: Prisma's migration engine is a
# native binary, and it picks its OpenSSL build from what it finds installed.
FROM node:${NODE_VERSION}-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store --filter @fld/api...
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma7.config.ts apps/api/

FROM node:${NODE_VERSION}-alpine
# The local storage driver keeps uploads in /data/storage; mount a volume there to keep them. A new
# named volume takes this directory's owner, so the API can write to it.
RUN apk add --no-cache openssl tini \
 && mkdir -p /data/storage \
 && chown node:node /data/storage
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_LOCAL_DIR=/data/storage \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
COPY --from=deps /repo /app
COPY apps/api/docker-entrypoint.sh /usr/local/bin/fld-entrypoint
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--", "fld-entrypoint"]
CMD ["node", "dist/main.js"]
