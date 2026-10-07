# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# Build all packages (TypeScript 7).
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build
# Keep only runtime files: manifests, compiled output, and SQL migrations.
RUN mkdir /out \
 && cp package.json pnpm-lock.yaml pnpm-workspace.yaml LICENSE NOTICE /out/ \
 && for dir in apps/* packages/*; do \
      mkdir -p "/out/$dir"; \
      cp "$dir/package.json" "/out/$dir/"; \
      for sub in dist migrations locales; do \
        if [ -d "$dir/$sub" ]; then cp -r "$dir/$sub" "/out/$dir/"; fi; \
      done; \
    done

# Install production dependencies for the bot only (without testcontainers or test tools).
FROM base AS production-dependencies
COPY --from=build /out ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter "@picket/bot..."
# i18next declares TypeScript as an optional peer: pnpm still installs it (native compiler with Go CVEs).
RUN rm -rf node_modules/.pnpm/typescript@* node_modules/.pnpm/@typescript+*

# Final image: no pnpm, no source files, and an unprivileged user.
FROM node:24-alpine AS runtime
ARG PICKET_VERSION=unknown
ENV NODE_ENV=production PICKET_VERSION=${PICKET_VERSION}
LABEL org.opencontainers.image.revision=${PICKET_VERSION}
WORKDIR /app
# npm is not used at runtime and bundles its own vulnerable dependencies.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=production-dependencies --chown=node:node /app ./
USER node
EXPOSE 8080
CMD ["node", "apps/bot/dist/main.js"]
