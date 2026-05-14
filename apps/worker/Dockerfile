# Build context expected: repo root (passar -f apps/worker/Dockerfile no docker build)
#
# Base: node:20-slim (Debian Bookworm) — NÃO Alpine.
# onnxruntime-node prebuilds linkam contra glibc (libc.so.6 + ld-linux-x86-64.so.2);
# Alpine usa musl libc e não tem ld-linux → require crasha com ERR_DLOPEN_FAILED.
# Trocar pra slim resolve. (~40MB a mais de imagem, aceitável.)
FROM node:20-slim
WORKDIR /app

# curl: download do modelo ONNX. ca-certificates: TLS handshake com huggingface.co.
# git: agente Trello QA Fix precisa clonar/commit/push em /app/repo.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git \
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

# Trello QA Fix Agent precisa de filesystem real do repo + .git pra edit/commit/push.
# Copiamos o repo inteiro pra /app/repo (TRELLO_REPO_ROOT env aponta pra cá).
# Inclui apps/api, apps/web, apps/worker, infra, docs, scripts, .git.
COPY apps /app/repo/apps
COPY infra /app/repo/infra
COPY .github /app/repo/.github
COPY package.json /app/repo/package.json
COPY CLAUDE.md /app/repo/CLAUDE.md
COPY .git /app/repo/.git

# Install node_modules in apps/api e apps/worker no /app/repo pra run_tests passar.
# (apps/web não precisa — fix agent não roda Angular tests por enquanto.)
WORKDIR /app/repo/apps/api
RUN npm ci --no-audit --no-fund
WORKDIR /app/repo/apps/worker
RUN npm ci --no-audit --no-fund
WORKDIR /app

# Docs e premissas — baked into image pra reindexação do Copilot em prod
COPY docs /app/docs
COPY CLAUDE.md /app/CLAUDE.md

CMD ["node", "src/index.js"]
