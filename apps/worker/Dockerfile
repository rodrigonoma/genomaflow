# Build context expected: repo root (passar -f apps/worker/Dockerfile no docker build)
FROM node:20-alpine
WORKDIR /app

COPY apps/worker/package.json apps/worker/package-lock.json ./
RUN npm ci --production

ARG CACHEBUST
COPY apps/worker/src ./src

# Docs e premissas — baked into image pra reindexação do Copilot em prod
COPY docs /app/docs
COPY CLAUDE.md /app/CLAUDE.md

CMD ["node", "src/index.js"]
