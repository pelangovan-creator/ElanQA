# API image - uses PostgreSQL (schema generated from the SQLite dev schema).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN node scripts/make-postgres-schema.mjs \
 && npx prisma generate --schema prisma/schema.postgres.prisma \
 && npx nest build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 4000
# Apply schema, seed the first admin (idempotent), then start.
CMD ["sh", "-c", "npx prisma db push --skip-generate --schema prisma/schema.postgres.prisma && npx ts-node --transpile-only prisma/seed.ts && node dist/main.js"]
