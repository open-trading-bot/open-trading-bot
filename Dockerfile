# --- Build server ---
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package*.json ./server/
COPY client/package.json ./client/
COPY backoffice/package.json ./backoffice/
COPY common/package.json ./common/
RUN npm ci --workspace=server --workspace=common
COPY server/ ./server/
COPY common/ ./common/
RUN cd server && npx tsc

# --- Build client ---
FROM node:20-alpine AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package*.json ./client/
COPY backoffice/package.json ./backoffice/
COPY common/package.json ./common/
RUN npm ci --workspace=client --workspace=common
COPY client/ ./client/
COPY common/ ./common/
RUN cd client && npm run build

# --- Production ---
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Server dependencies, from the root workspace lockfile
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY backoffice/package.json ./backoffice/
COPY common/package.json ./common/
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm ci --omit=dev --workspace=server \
  && apk del .build-deps \
  && npm cache clean --force

# Server, and the client static files that the server serves
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./server/public

# The server runs as the unprivileged "node" user. It writes only to data/ and logs/.
RUN mkdir -p data logs && chown node:node data logs
USER node

EXPOSE 3001
CMD ["node", "server/dist/index.js"]
