# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# Compilation de tous les packages (TypeScript 7).
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build
# Ne garde que ce qui sert à l'exécution : manifestes, sorties compilées, migrations SQL.
RUN mkdir /out \
 && cp package.json pnpm-lock.yaml pnpm-workspace.yaml LICENSE NOTICE /out/ \
 && for dir in apps/* packages/*; do \
      mkdir -p "/out/$dir"; \
      cp "$dir/package.json" "/out/$dir/"; \
      for sub in dist migrations locales; do \
        if [ -d "$dir/$sub" ]; then cp -r "$dir/$sub" "/out/$dir/"; fi; \
      done; \
    done

# Dépendances de production du seul bot (sans testcontainers ni outils de test).
FROM base AS production-dependencies
COPY --from=build /out ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile --filter "@picket/bot..."
# i18next déclare TypeScript en peer optionnel : pnpm l'installe quand même (compilateur natif et ses CVE Go).
RUN rm -rf node_modules/.pnpm/typescript@* node_modules/.pnpm/@typescript+*

# Image finale : pas de pnpm, pas de sources, utilisateur non privilégié.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# npm n'est pas utilisé à l'exécution et embarque ses propres dépendances vulnérables.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=production-dependencies --chown=node:node /app ./
USER node
EXPOSE 8080
CMD ["node", "apps/bot/dist/main.js"]
