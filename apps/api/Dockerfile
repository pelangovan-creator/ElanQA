# syntax=docker/dockerfile:1
# API image (PostgreSQL). Based on the official Playwright image so test runs and
# PDF exports have Chromium, Firefox and WebKit with all system libraries.
# Keep the tag in step with the "playwright" version in apps/api/package.json.
ARG PW_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble

FROM ${PW_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/demo/package.json apps/demo/
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=npm_ca,src=/path/ca.pem ...
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN node scripts/make-postgres-schema.mjs \
 && npx prisma generate --schema prisma/schema.postgres.prisma \
 && npx nest build \
 && rm -f prisma/*.db

FROM ${PW_IMAGE}
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright STORAGE_DIR=/data/storage PORT=4000
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/apps/api ./apps/api
RUN mkdir -p /data/storage && chown -R pwuser:pwuser /data
# Run as the image's unprivileged user, not root.
USER pwuser
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply the schema, seed the first admin (idempotent), then start.
CMD ["sh", "-c", "npx prisma db push --skip-generate --schema prisma/schema.postgres.prisma && npx ts-node --transpile-only prisma/seed.ts && exec node dist/main.js"]
