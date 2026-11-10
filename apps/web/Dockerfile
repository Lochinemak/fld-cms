# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/web/Dockerfile -t fld-cms-web .

ARG NODE_VERSION=24

# The static build is the same for every platform, so it runs once on the builder's own.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @fld/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @fld/shared build && pnpm --filter @fld/web build

FROM nginxinc/nginx-unprivileged:1.31-alpine
# The API service, and the DNS server that resolves it (Docker's own by default).
ENV API_UPSTREAM=http://api:3000 \
    NGINX_RESOLVER=127.0.0.11
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
