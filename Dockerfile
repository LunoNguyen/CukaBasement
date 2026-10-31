# syntax=docker/dockerfile:1.7
#
# One file, three images:
#   docker build --target api    -t cuka-api .
#   docker build --target worker -t cuka-worker .
#   docker build --target web    -t cuka-web .
# docker-compose.yml builds all three (and runs the one-shot `setup` from the api image).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

# ---------------------------------------------------------------------------------------------------------------
# build: full install (dev deps included) and every workspace built.
FROM ${NODE_IMAGE} AS build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# Toolchain for native addons (argon2, sharp) when no prebuilt binary matches; only this stage has it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Manifests first so the dependency layer survives app-code changes. packages/shared comes along because the
# root `prepare` script (run by `npm ci`) builds it.
COPY package.json package-lock.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
# shared -> api -> worker (its prebuild rebuilds api, which the worker imports from dist) -> web.
# The web uses build-only: type-checking belongs to CI (`npm run type-check`), not to the image build.
RUN npm -w @cuka/shared run build \
  && npm -w @cuka/api run build \
  && npm -w @cuka/worker run build \
  && npm -w @cuka/web run build-only

# ---------------------------------------------------------------------------------------------------------------
# prod-files: production node_modules plus only what api/worker need at runtime.
FROM build AS prod-files
# Removing apps/web first takes it out of the `apps/*` workspaces, so the prune also drops the web's dependencies.
RUN rm -rf apps/web \
  && npm prune --omit=dev \
  && rm -rf apps/*/src apps/*/test apps/*/tsconfig*.json apps/*/vitest.config.* \
     packages/shared/src packages/shared/test packages/shared/tsconfig*.json \
     apps/*/*.tsbuildinfo packages/shared/*.tsbuildinfo \
  && find . -maxdepth 1 -mindepth 1 ! -name node_modules ! -name apps ! -name packages ! -name package.json \
     ! -name package-lock.json -exec rm -rf {} +

# ---------------------------------------------------------------------------------------------------------------
# runtime: shared base of the api and worker images.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    BACKUP_DIR=/data/backups
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/backups && chown node:node /data/backups
WORKDIR /app
COPY --from=prod-files /app ./
USER node
VOLUME ["/data/backups"]
# No init in the image: compose sets `init: true` (or use `docker run --init`); both apps handle SIGTERM.

# ---------------------------------------------------------------------------------------------------------------
FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]

# ---------------------------------------------------------------------------------------------------------------
FROM runtime AS api
ENV API_PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

# ---------------------------------------------------------------------------------------------------------------
# web: nginx serving the SPA and proxying /api and /og to the api service.
FROM ${NGINX_IMAGE} AS web
# The image's entrypoint runs envsubst on /etc/nginx/templates/*.template (only for variables that are set).
ENV API_UPSTREAM=api:3000 \
    NGINX_CLIENT_MAX_BODY_SIZE=50g \
    NGINX_BACKUP_TIMEOUT=7200s
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
