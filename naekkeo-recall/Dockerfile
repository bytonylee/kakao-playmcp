FROM node:22-bookworm-slim AS build

WORKDIR /app/naekkeo-recall
COPY naekkeo-recall/package*.json ./
RUN npm ci
COPY naekkeo-recall/ ./
RUN npm run build

FROM node:22-bookworm-slim AS production-deps

WORKDIR /app/naekkeo-recall
COPY naekkeo-recall/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
COPY --chown=node:node naekkeo-recall/package.json ./package.json
COPY --from=production-deps --chown=node:node /app/naekkeo-recall/node_modules ./node_modules
COPY --from=build --chown=node:node /app/naekkeo-recall/dist ./dist
COPY --chown=node:node naekkeo-recall/docker-healthcheck.mjs ./docker-healthcheck.mjs

EXPOSE 8000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "docker-healthcheck.mjs"]
CMD ["node", "dist/index.js"]
