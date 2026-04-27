---
name: URL routing rules
description: Split landing × app — apex/www serve só landing, app.genomaflow.com.br serve Angular SPA (desde 2026-04-27)
type: project
originSessionId: 6e03ff44-994d-4989-8d23-6ad314de1080
---

**Mudança 2026-04-27:** subdomínios separados pra deixar landing limpa, sem Angular SPA por baixo.

## Domínios em produção

| Host | O que serve | Comportamento |
|---|---|---|
| `genomaflow.com.br` | Landing page (HTML estático) | `/` serve `apps/landing/index.html`. Outros paths → **301 pra `app.genomaflow.com.br`** (preserva bookmarks). |
| `www.genomaflow.com.br` | Idem apex | Idem |
| `app.genomaflow.com.br` | Angular SPA + API | `/api/*` → API target group. Outros paths → Angular (`/login`, `/onboarding`, `/doctor/*`, `/clinic/*`, `/master`). |

## Como funciona

- **Cert ACM**: wildcard `*.genomaflow.com.br` cobre `app.` (mesmo cert do apex)
- **ALB rules**:
  - priority 5: host=app + path /api/* → API TG
  - priority 10: host=app → Web TG (Angular)
  - default: apex/www → Web TG (nginx serve só landing)
- **nginx** (`docker/nginx.conf`) tem 2 server blocks distintos:
  - `genomaflow.com.br www.genomaflow.com.br` → root `landing/`, redirect 301 catch-all
  - `app.genomaflow.com.br` → Angular SPA com try_files fallback
- **Landing CTAs** (`apps/landing/index.html:2380`): `APP_BASE = 'https://app.genomaflow.com.br'`. Botão Entrar → `${APP_BASE}/login`, Registrar → `${APP_BASE}/onboarding`.
- **Email links** (verificação, reset): `FRONTEND_URL=https://app.genomaflow.com.br` no task def ECS (`infra/lib/ecs-stack.ts`). NUNCA apontar pro apex em emails.

## Regras invioláveis

- Apex / www **nunca** pode servir o Angular SPA — só landing
- Nenhum email/link/redirect interno pode apontar pro apex pra ações que exigem login (`/login`, `/onboarding`, `/dashboard` etc.) — sempre `app.`
- Cookies/localStorage **não atravessam subdomínios** — se um dia mover algo entre apex/app, todos os usuários são deslogados

## Como adicionar novo host

1. Add A record no `infra/lib/ecs-stack.ts` (Route53 alias pro ALB)
2. Add ALB rule com `hostHeaders([...])` na priority adequada
3. Add server block no `docker/nginx.conf`
4. `cdk deploy genomaflow-ecs` + push do código

## Histórico

- **Antes 2026-04-27**: 1 só nginx server block catch-all (`server_name _`). Apex servia tanto landing (em `/` exato) quanto Angular SPA (fallback em qualquer path). Visualmente parecia OK mas misturava marketing com app, dificultava SEO da landing e expunha a SPA inteira em URLs canônicas tipo `genomaflow.com.br/login`.
- **Cutover** feito sem usuários ativos em prod (zero impacto de deslogamento).
