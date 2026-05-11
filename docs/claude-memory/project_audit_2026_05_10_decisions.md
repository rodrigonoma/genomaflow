---
name: Auditoria 2026-05-10 — decisões deferidas / canceladas
description: Itens da auditoria técnica que o usuário decidiu NÃO fazer, com motivo. Não propor de novo a menos que o contexto mude (ex: incidente real).
type: project
---

# Decisões pós-auditoria (2026-05-10 / 2026-05-11)

A auditoria técnica de 2026-05-10 listou ~10 itens críticos/alto. Após
entrega de 9 PRs, o usuário decidiu **encerrar** os seguintes itens.

## Cancelados (NÃO propor de novo)

### PR14 — OIDC AWS (substituir access key)
- **Quando:** Aborted 2026-05-10
- **Why:** decisão do usuário. Continua usando access key + secret hardcoded
  no GitHub Secrets (`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`).
- **How to apply:** Não propor PR de OIDC sem que o usuário pedir
  explicitamente OU sem que tenha incidente real de vazamento de chave.

### PR15 — NODE_TLS_REJECT_UNAUTHORIZED=0 → CA bundle RDS
- **Quando:** Cancelado 2026-05-11
- **Why:** decisão do usuário. Risco de MITM entre ECS↔RDS exige atacante
  já dentro da VPC privada — baixa probabilidade. Custo de implementação
  (baixar CA bundle, embed em todas as Dockerfiles, validar em staging)
  julgado maior que o ganho.
- **How to apply:** `NODE_TLS_REJECT_UNAUTHORIZED=0` continua em
  `infra/lib/ecs-stack.ts`. Não propor remoção sem incidente real.

### PR16 — Redis TLS (`rediss://` + AUTH token)
- **Quando:** Cancelado 2026-05-11
- **Why:** decisão do usuário. Mesma análise de risco do PR15 (MITM
  interno, baixa prob.). Mas custo MUITO maior — Redis local em dev não
  tem TLS, precisa flag por ambiente, BullMQ+ioredis+pubsub.js todos
  exigem TLS opts, alto risco de derrubar fila/chat/sessões em prod se
  uma config falhar.
- **How to apply:** Redis continua `redis://` sem auth. Não propor de
  novo. Se um dia for fazer, planejar como projeto formal (dia inteiro
  de trabalho + staging completo), não como PR de zero-risco.

## Falsos positivos da auditoria (NÃO existe bug)

### PR11 — ACL `role !== 'admin'` nas 5 rotas
- **Quando descoberto:** 2026-05-11
- **O que o auditor disse:** clinical-documents/vaccines/nps/notifications/
  portal usam `role !== 'admin'` (mestre-mascarado-de-admin) e sugeriu
  trocar pra `role === 'master'`.
- **Verdade do código:** todas as 5 rotas usam o padrão **correto**
  `if (role !== 'admin' && role !== 'master') return 403`. O auditor leu
  o snippet ignorando a segunda condição.
- **Se aplicado cego:** seria catástrofe — bloquearia TODOS os admins de
  clínica (todas as clínicas pagantes) de criar template de documento,
  cadastrar protocolo de vacina, mandar NPS, configurar notificações,
  gerar token de portal. Quebra funcional total.
- **Outras rotas com `role !== 'admin'` puro** (sem `master`): billing,
  clinic, integrations, inter-tenant-chat/*, users — TODAS são
  admin-of-tenant onde master tem rotas próprias em `/master/*`.
  Bloquear master nelas é correto.
- **How to apply:** NÃO propor PR11 de novo. Auditoria errou.

## Ainda pendentes (válidos pra propor)

- **PR13 — SNS signature em `/webhooks/ses`**. Endpoint público hoje
  permite atacante anônimo suprimir emails de qualquer cliente. Fix
  isolado, rollback claro via flag.

## Lembrete

Auditoria completa em `session_2026_05_10_audit_pr1.md` (rodapé tem
fila completa). Score pós-9-PRs subiu de média 7.4 → ~8.3.
