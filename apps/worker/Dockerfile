# Build context expected: repo root (passar -f apps/worker/Dockerfile no docker build)
#
# Base: node:20-slim (Debian Bookworm) — NÃO Alpine.
# onnxruntime-node prebuilds linkam contra glibc (libc.so.6 + ld-linux-x86-64.so.2);
# Alpine usa musl libc e não tem ld-linux → require crasha com ERR_DLOPEN_FAILED.
# Trocar pra slim resolve. (~40MB a mais de imagem, aceitável.)
FROM node:20-slim
WORKDIR /app

# curl: download do modelo ONNX. ca-certificates: TLS handshake com huggingface.co.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# Trello QA Agent (T9 processor): worker processor faz cross-app require de
# apps/api/src/services/{trello-fix-attempts,trello-client}.js via paths
# relativos `../../../api/src/services/...`. O build context é o repo root,
# mas o Dockerfile precisa COPIAR esses arquivos pro lugar onde o require
# espera (/app/api/src/services/). Sem esse COPY, container crasha no module
# load do processor antes mesmo de escrever a primeira linha de log.
# Tech debt: idealmente esses services moveriam pra apps/shared ou seriam
# duplicados em apps/worker/src/services/ (sem coupling cross-app).
COPY apps/api/src/services/trello-fix-attempts.js /app/api/src/services/trello-fix-attempts.js
COPY apps/api/src/services/trello-client.js /app/api/src/services/trello-client.js

# Docs e premissas — baked into image pra reindexação do Copilot em prod
COPY docs /app/docs
COPY CLAUDE.md /app/CLAUDE.md

CMD ["node", "src/index.js"]
