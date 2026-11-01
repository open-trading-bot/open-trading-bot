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
RUN apk add --no-cache python3 make g++
WORKDIR /app

# Server
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/package.json ./
RUN npm install --omit=dev && apk del python3 make g++
RUN mkdir -p data logs

# Client static files
COPY --from=client-build /app/client/dist ./public

EXPOSE 3001
CMD ["node", "dist/index.js"]
