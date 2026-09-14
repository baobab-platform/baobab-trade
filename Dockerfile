FROM node:26.8-alpine3.24 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build

FROM node:26.8-alpine3.24 AS runtime
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
CMD ["node", "node_modules/@medusajs/cli/cli.js", "start"]
