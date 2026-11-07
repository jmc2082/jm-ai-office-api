# Phase 0 image. Phase 1 switches the runtime base to the Playwright image
# (mcr.microsoft.com/playwright, amd64 to match the t3 box) so workers can drive browsers.

FROM node:24-bookworm-slim AS build
# better-sqlite3 compiles from source when no prebuilt binary matches this Node version.
# These tools stay in the build stage; the runtime image doesn't need them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATABASE_PATH=/data/office.db
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:4100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
