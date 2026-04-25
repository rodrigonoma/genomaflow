---
name: IAM S3 — policy precisa cobrir todos os prefixos que o app usa
description: Adicionar feature que escreve em prefixo S3 novo exige atualizar a IAM policy da task ECS — bug latente clássico
type: feedback
---

A task role do ECS (`genomaflow-ecs-TaskRole30FC0FBB-*`) tem policy inline `genomaflow-s3-uploads` que define quais prefixos do bucket `genomaflow-uploads-prod` o app pode escrever/ler/apagar.

**Sintoma quando esquece**: feature nova que escreve em prefixo novo dá `AccessDenied: User ... is not authorized to perform: s3:PutObject on resource ...` — geralmente vira HTTP 500 silencioso pro usuário.

**Por quê é fácil esquecer**:
- Em dev local não tem essa policy (S3 mockado ou roda com creds de admin)
- Smoke tests síncronos no curl podem não exercitar o upload
- ALB retorna 500 só quando o app tenta o `PutObject` real

**Como aplicar**:
1. Quando criar feature que faz `uploadFile(key, ...)`, conferir se o prefixo está coberto pela policy.
2. Atualmente a policy cobre o bucket inteiro:
   ```json
   { "Action": ["s3:PutObject","s3:GetObject","s3:DeleteObject"],
     "Resource": "arn:aws:s3:::genomaflow-uploads-prod/*" }
   ```
   Se mudar pra escopo mais restrito por prefixo no futuro, lembrar de adicionar todos: `uploads/*`, `inter-tenant-chat/*`, `inter-tenant-chat-redact/*`, `logos/*`, etc.

**Why**: 2026-04-25 — V1 da redação de PII (image-redact endpoint) escrevia em prefixo `inter-tenant-chat-redact/*` não coberto pela policy original (que só permitia `uploads/*`). Bug similar latente no Phase 5 do chat (PDF/imagem em `inter-tenant-chat/*`) só não tinha pegado ninguém porque nenhum usuário em prod tinha anexado. Fix consolidou a policy pra liberar o bucket inteiro (justificado: bucket dedicado, sem risco de vazamento cross-recurso).

**Como auditar**:
```bash
aws iam get-role-policy \
  --role-name genomaflow-ecs-TaskRole30FC0FBB-X8VwPleSzZCP \
  --policy-name genomaflow-s3-uploads --query 'PolicyDocument'
```

E procurar uso de `uploadFile` no código:
```bash
grep -rn "uploadFile(" apps/api/src/ | grep -v "node_modules"
```

---

## Bonus — CORS do bucket

Se uma feature carrega arquivos S3 **dentro do browser** (canvas, fetch com `crossOrigin`, leitura de pixels), o bucket precisa ter CORS configurado. Sem CORS:
- `<img src=signedUrl>` simples funciona (browser só renderiza)
- `<img crossOrigin='anonymous'>` quebra silenciosamente — `onerror` dispara
- `fetch(signedUrl)` quebra com erro CORS

Config atual em `genomaflow-uploads-prod`:
```bash
aws s3api get-bucket-cors --bucket genomaflow-uploads-prod
```
Permite GET de `https://genomaflow.com.br`, `https://www.genomaflow.com.br`, `http://localhost:4200`. Se adicionar novo domínio (ex: app.genomaflow.com.br no futuro), atualizar.

**Why incluir aqui:** o redact endpoint (2026-04-25) precisou simultaneamente de fix de IAM e CORS. Os dois são lições da mesma feature, então ficam juntos.
