FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --ignore-scripts
COPY contracts contracts
COPY backend/tsconfig.json backend/tsconfig.json
COPY backend/src backend/src
RUN npm run build -w contracts && npm run build -w backend && npm prune --omit=dev --ignore-scripts
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
# Apply Debian security updates and remove build-only package managers.
# Runtime invokes node directly and never installs or executes target dependencies.
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/contracts contracts
COPY --from=build --chown=node:node /app/backend backend
COPY --chown=node:node migrations migrations
USER node
EXPOSE 3001
CMD ["node", "backend/dist/server.js"]
