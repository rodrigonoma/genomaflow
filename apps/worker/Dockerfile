# Build context expected: repo root (passar -f apps/worker/Dockerfile no docker build)
FROM node:20-alpine
WORKDIR /app

# curl necessário pra download do modelo ONNX (camada separada cacheável)
RUN apk add --no-cache curl

COPY apps/worker/package.json apps/worker/package-lock.json ./
RUN npm ci --production

# V2 Fase 3 F3.1-B.2: Depth-Anything-V2-Small ONNX (~100MB).
# Camada separada pra cachear entre builds (modelo só re-baixa quando URL muda).
# DEPTH_ANYTHING_MODEL_PATH é resolvida em runtime (default /app/models/...).
RUN mkdir -p /app/models && \
    curl -fL --retry 3 --retry-delay 5 \
      -o /app/models/depth-anything-v2-small.onnx \
      https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx && \
    ls -lh /app/models/

ARG CACHEBUST
COPY apps/worker/src ./src

# Docs e premissas — baked into image pra reindexação do Copilot em prod
COPY docs /app/docs
COPY CLAUDE.md /app/CLAUDE.md

CMD ["node", "src/index.js"]
