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
ARG VITE_RECAPTCHA_SITE_KEY
ENV VITE_RECAPTCHA_SITE_KEY=$VITE_RECAPTCHA_SITE_KEY
ARG GIT_COMMIT_SHA
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
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

# --- Build backoffice ---
FROM node:20-alpine AS backoffice-build
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG GIT_COMMIT_SHA
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY backoffice/package*.json ./backoffice/
COPY common/package.json ./common/
RUN npm ci --workspace=backoffice --workspace=common
COPY backoffice/ ./backoffice/
COPY common/ ./common/
RUN cd backoffice && npm run build

# --- Production server ---
FROM node:20-alpine AS server
WORKDIR /app
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/package*.json ./
RUN npm ci --omit=dev
RUN mkdir -p data
EXPOSE 3001
CMD ["node", "dist/index.js"]

# --- Production client (nginx) ---
FROM nginx:alpine AS client
COPY --from=client-build /app/client/dist /usr/share/nginx/html
COPY docker/nginx.client.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# --- Production backoffice (nginx) ---
FROM nginx:alpine AS backoffice
COPY --from=backoffice-build /app/backoffice/dist /usr/share/nginx/html
COPY docker/nginx.backoffice.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
