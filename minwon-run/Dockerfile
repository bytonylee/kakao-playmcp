FROM node:22-bookworm-slim AS build

WORKDIR /app/minwon-run
COPY minwon-run/package*.json ./
RUN npm ci
COPY minwon-run/ ./
RUN npm run build

FROM node:22-bookworm-slim AS production-deps

WORKDIR /app/minwon-run
COPY minwon-run/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
COPY --chown=node:node minwon-run/package.json ./package.json
COPY --from=production-deps --chown=node:node /app/minwon-run/node_modules ./node_modules
COPY --from=build --chown=node:node /app/minwon-run/dist ./dist
COPY --chown=node:node minwon-run/docker-healthcheck.mjs ./docker-healthcheck.mjs

EXPOSE 8000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "docker-healthcheck.mjs"]
CMD ["node", "dist/index.js"]
