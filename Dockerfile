# ── сборка ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps ./apps

RUN pnpm --filter @fatoff/contracts run build \
 && pnpm --filter @fatoff/web run build \
 && pnpm --filter @fatoff/api run build

# продакшен-зависимости отдельным слоем, без devDependencies
RUN pnpm --filter @fatoff/api --prod --legacy deploy /out \
 && cp -r apps/api/dist /out/dist

# ── исполнение ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /out ./apps/api
COPY --from=build /app/apps/web/.output/public ./apps/web/.output/public

RUN mkdir -p /app/storage/exports

WORKDIR /app/apps/api
EXPOSE 4090

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
