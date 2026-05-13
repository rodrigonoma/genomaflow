---
name: Alpine + glibc native modules
description: node:20-alpine quebra silenciosamente com módulos node nativos linkados em glibc (onnxruntime-node, sharp-prebuild, certain canvas). Usar node:20-slim quando há prebuilt nativo. Incidente 2026-05-13.
type: feedback
---

# Alpine Linux quebra módulos nativos linkados em glibc

**Regra:** quando worker/api/serviço adicionar dependência com binário nativo prebuilt (onnxruntime-node, sharp, canvas, bcrypt-prebuilt, etc.), checar se o pacote tem prebuild pra musl (Alpine) OU trocar base image pra Debian slim antes de mergear.

**Why:** em 2026-05-13 a feature F3.1-B.2 (Aesthetic V2 Pseudo-3D) adicionou `onnxruntime-node@^1.26` ao worker sem trocar Dockerfile. Containers EM EXECUÇÃO continuaram funcionando (lazy load do require não foi executado nas tasks ativas). Mas TODA task NOVA disparada (cdk deploy, force-new-deployment, scaling, deploy.yml) crashava com:

```
Error: Error loading shared library ld-linux-x86-64.so.2: No such file or directory
(needed by /app/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1)
ERR_DLOPEN_FAILED
```

Causa: Alpine usa musl libc. onnxruntime-node prebuild linka contra glibc (libc.so.6 + ld-linux-x86-64.so.2). Não tem prebuild musl. require crasha antes de qualquer linha de código rodar.

**Detectar:** sintoma é o worker rodar normal no container existente mas TODA task nova entrar em loop CrashLoopBackOff. ECS Deployment Circuit Breaker triggera após N falhas. CloudFormation rollback pode falhar (UPDATE_ROLLBACK_FAILED) porque a task def "anterior" também tem o bug.

**How to apply:** sempre que adicionar dep nativa, fazer este checklist:

1. `npm view <pkg> dependencies` + checar README do pacote — tem prebuild pra `linux-musl-x64`?
2. Se NÃO: trocar `FROM node:20-alpine` → `FROM node:20-slim` no Dockerfile correspondente
3. Trocar comandos: `apk add --no-cache curl` → `apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*`
4. Testar build local: `docker build -f apps/worker/Dockerfile -t worker-test . && docker run --rm worker-test node -e "require('onnxruntime-node')"`
5. Se passa, deploy

**Pacotes conhecidos sem prebuild musl (precisam Debian slim):**
- `onnxruntime-node` (~1.26+) — sem prebuild musl
- `canvas` — precisa cairo/pango do sistema

**Pacotes que TEM prebuild musl (Alpine OK):**
- `sharp` (libvips embarcado no prebuild)
- `bcrypt` (com tag musl)
- `ioredis`, `pg`, etc. (puro JS, sem nativo)

**Trade-off de imagem:**
- `node:20-alpine`: ~150MB
- `node:20-slim` (Bookworm): ~190MB
- Diferença aceitável. Cold start de Fargate task é dominado por outras coisas.

## Não regredir

❌ Não voltar pra Alpine no worker enquanto onnxruntime-node estiver na árvore
❌ Não confiar que "tá rodando" — container já vivo NÃO testa o require em path-of-life-startup; só task NOVA testa
❌ Não rodar `cdk deploy` que mexe em task def sem antes confirmar que `docker run image-tag node src/index.js` sobe limpo localmente

✅ Sempre rodar build + execução local quando trocar base image OU adicionar dep nativa
✅ Sempre confirmar smoke prod com nova task (ex: `aws ecs update-service --force-new-deployment` + monitor)
