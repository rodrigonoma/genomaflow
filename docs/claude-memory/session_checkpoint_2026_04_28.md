---
name: Session Checkpoint — 2026-04-28
description: Estado de trabalho ao fim da sessão 2026-04-27. Como retomar, processo estabelecido, último HEAD, features entregues.
type: project
---

# Estado pós-sessão 2026-04-27 → 2026-04-28

## Como retomar

Ao iniciar nova sessão, ler primeiro:
1. `MEMORY.md` (índice)
2. `project_context.md` — estado atual
3. `feedback_code_editing_rules.md` — regras invioláveis (Write proibido, stash proibido, vibe coding proibido)
4. **Esse arquivo** — pra entrar no ritmo já estabelecido

Confirmar estado git:
```bash
git stash list                              # vazio
git branch -a                                # só main local + origin/main
git log --oneline -10
gh run list --workflow=deploy.yml --limit 3
```

## Último HEAD na main (antes do reboot)

`bc05983f` — `merge: fix/mobile-responsive-chat-agenda → main`

10 commits recentes:
```
bc05983f merge: fix/mobile-responsive-chat-agenda → main
2a47e826 merge: fix/master-broadcast-readonly → main
897de9d8 docs(memory): registra lição CDK drift
e72f2660 fix(infra): DATABASE_URL precisa de ?sslmode=require
28627b01 fix(routing): priority 11 (não 10) pra AppHost
bd271d60 merge: feat/split-app-subdomain → main
a12365fe merge: fix/master-broadcast-ws-event-name → main
3d8cd66b merge: docs/master-broadcasts-finalize → main
9c26c143 merge: docs/master-broadcasts-spec-and-plan → main
188bf5be merge: feat/master-broadcasts-master-ui → main
```

## Entregue na sessão (resumo)

1. **Audit log Option B** (migrations 055-057) — triggers Postgres + master panel
2. **Mic 15s timeout** — VoiceInputService idle auto-stop
3. **Master Broadcasts** (migrations 058-061) — Comunicados, read-only pro tenant
4. **Split landing × app** — apex landing only, app.* Angular, 308 catch-all
5. **Mobile responsive** — chat + agenda + comunicados otimizados
6. **CDK drift fix** — DATABASE_URL ?sslmode=require restaurado após cdk deploy
7. **WS event names fix** — master broadcast usa `chat:message_received` + `chat:unread_change`

## Processo estabelecido (segue rigorosamente)

1. **Brainstorm com personas seniores** (Eng Software, Arquiteto, PO, UX, Eng Dados, DBA) antes de mexer em algo não-trivial
2. **Spec → plano → fases** pra features grandes (`docs/superpowers/specs/` + `docs/superpowers/plans/`)
3. **Branch por fase**, testes locais, smoke E2E em Docker, commit + push
4. **Aprovação explícita do usuário antes de mergar** (`sim`, `pode mergear`)
5. **Após merge → deletar branch** local + remoto
6. **Atualizar memória** após feature entregue
7. **Higienização final** quando o usuário pede ou ao fim de sessão

Convenções:
- Commits em PT-BR `feat(escopo): ...` / `fix(escopo): ...` / `docs(escopo): ...` com Co-Authored-By
- Mensagens detalhadas (causa, fix, testes)
- Migrations idempotentes
- CI gate `npm run test:unit` (subset sem DB)
- WebSocket via `fastify.redis.publish('chat:event:{tenant}', ...)`, nunca notifyTenant direto

## Estado dos testes

- API CI gate: **405 passed / 3 skipped / 19 suites**
- Web: **31 passed / 3 skipped / 6 suites**
- Inter-tenant integração (DB-dep): **132 verdes**

## Sem trabalho pendente

Tudo mergeado. Stashes vazio. Branches: só `main`.

## Para retomar

Quando o usuário voltar e propor algo novo:
1. Cumprimentar e confirmar contexto
2. Brainstorm com personas → decisões abertas → aguardar resposta
3. Spec/plano se for não-trivial
4. Fase a fase, sempre pedindo OK pra mergar
5. Atualizar memória após delivery

Se pedir "continuemos do que paramos" sem detalhe, perguntar **o que** continuar — não há WIP, tudo está em prod.
