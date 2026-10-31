# syntax=docker/dockerfile:1
# ShopEasy demo app (application under test). Optional: docker compose --profile demo up
FROM node:22-bookworm-slim
WORKDIR /app
COPY apps/demo/package.json ./
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=npm_ca,src=/path/ca.pem ...
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm install --omit=dev --no-audit --no-fund
COPY apps/demo/server.js ./
ENV DEMO_PORT=4600
USER node
EXPOSE 4600
CMD ["node", "server.js"]
