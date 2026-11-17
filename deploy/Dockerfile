FROM node:22-bookworm-slim AS build

# better-sqlite3 compiles from source when no prebuilt binary matches this Node release.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/tsconfig.build.json packages/shared/
COPY packages/server/package.json packages/server/tsconfig.json packages/server/tsconfig.build.json packages/server/
COPY packages/web/package.json packages/web/tsconfig.json packages/web/vite.config.ts packages/web/index.html packages/web/
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle
COPY packages/server/scripts packages/server/scripts
COPY packages/web/src packages/web/src
COPY skill skill

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @agentcowork/shared build && pnpm --filter @agentcowork/web build && pnpm --filter agentcowork build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV AGENTCOWORK_BIND=0.0.0.0
ENV AGENTCOWORK_DB=/data/agentcowork.db
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/drizzle packages/server/drizzle
COPY --from=build /app/packages/server/web packages/server/web
COPY --from=build /app/packages/server/skill packages/server/skill
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=build /app/packages/server/node_modules packages/server/node_modules

RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 7420
VOLUME ["/data"]

CMD ["node", "packages/server/dist/cli.js", "serve"]
