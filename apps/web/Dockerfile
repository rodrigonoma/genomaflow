# Stage 1: build
FROM node:20-alpine AS build
WORKDIR /app
# scripts/ precisa estar disponível ANTES de npm ci porque postinstall roda
# scripts/download-mediapipe-assets.js (self-host MediaPipe WASM+models).
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
ARG CACHEBUST
COPY . .
RUN npx ng build --configuration=production

# Stage 2: serve
FROM nginx:alpine
COPY --from=build /app/dist/genomaflow-web/browser /usr/share/nginx/html
COPY --from=build /app/landing /usr/share/nginx/landing
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
