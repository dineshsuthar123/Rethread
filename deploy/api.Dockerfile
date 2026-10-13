FROM node:22.17.0-bookworm-slim AS build
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
FROM node:22.17.0-bookworm-slim
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/contracts contracts
COPY --from=build --chown=node:node /app/backend backend
COPY --chown=node:node migrations migrations
USER node
EXPOSE 3001
CMD ["node", "backend/dist/server.js"]
