ARG NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
FROM ${NODE_IMAGE} AS build

WORKDIR /app/naekkeo-recall
COPY naekkeo-recall/package*.json ./
RUN npm ci
COPY naekkeo-recall/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS production-deps

WORKDIR /app/naekkeo-recall
COPY naekkeo-recall/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY naekkeo-recall/package.json ./package.json
COPY --from=production-deps /app/naekkeo-recall/node_modules ./node_modules
COPY --from=build /app/naekkeo-recall/dist ./dist
COPY naekkeo-recall/docker-healthcheck.mjs ./docker-healthcheck.mjs
RUN chmod -R a-w /app

EXPOSE 8000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "docker-healthcheck.mjs"]
CMD ["node", "dist/index.js"]
