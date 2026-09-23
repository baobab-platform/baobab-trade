FROM node:24.18.0-alpine3.24 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24.18.0-alpine3.24 AS runtime
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/baobab-platform/baobab-trade" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV NODE_ENV=production
WORKDIR /app
RUN apk upgrade --no-cache && chown node:node /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --chown=node:node --from=build /app/.medusa ./.medusa
COPY --chown=node:node medusa-config.ts ./medusa-config.ts
USER node
EXPOSE 9000
# Medusa's built-in liveness route; the runtime image has node but no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 9000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "node_modules/@medusajs/cli/cli.js", "start"]
