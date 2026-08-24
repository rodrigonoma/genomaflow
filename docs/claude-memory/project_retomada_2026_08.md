---
name: Retomada do projeto — agosto/2026
description: O que foi encontrado quando o projeto voltou a ser ativo depois de ~3 meses parado, o que já foi corrigido e o que continua pendente
type: project
---

# Retomada — 24/08/2026

Projeto sem commits desde 02/06/2026 (migração AWS→VPS) exceto três commits de
documentação em 23/08. Esta é a verificação feita ao retomar, direto na
produção e no DNS — não é leitura de documento antigo.

---

## O que estava saudável

- VPS `2.25.163.251`: os 7 contêineres do GenomaFlow de pé há 6 dias
  (18 no total na máquina, dividida com Auditty e Auditty-Sales)
- Postgres saudável, **12 tenants**, **106 migrations aplicadas** — exatamente
  as 106 do repositório. Schema em dia, zero drift
- API respondendo (401 sem token, que é o correto); `web /health` devolvendo `ok`
- Código: produção em `73e39d0`, e o que faltava eram só commits de docs

## O que estava quebrado

### 1. DNS morto — a causa raiz demorou a aparecer

Não era falta de registro `A`. O **registro.br continua delegando** o domínio
para 4 nameservers do **Route 53** cuja hosted zone foi apagada no cleanup da
AWS. Eles respondem `REFUSED` → `SERVFAIL` em qualquer resolver.

RDAP do registro.br: `delegation check 2026-08-21 → "ns query refused"`,
`last correct delegation → 2026-07-13`. **Quebrado há ~6 semanas.**

⚠️ **Lição:** desligar infraestrutura de nuvem derruba o DNS junto se a zona
morava lá. O produto continuou de pé o tempo todo — só inalcançável pelo nome,
o que é indistinguível de "ninguém acessou" em qualquer painel interno.

Decisão (24/08): hospedar a zona na **Hostinger**. Registros e ordem de
execução em `../DEPLOY.md`.

⏰ **Certificado do Caddy vence 31/08/2026** — emitido em 02/06, e o Caddy só
renova depois que o DNS apontar para a VPS.

### 2. Chime sem credencial → vídeo consulta morta

O IAM user do Chime foi apagado no cleanup. Confirmado rodando o SDK dentro do
contêiner: `UnrecognizedClientException`. As credenciais em
`aws/credentials` (local) também estão inválidas — a conta AWS não responde mais.

Corrigido em 24/08: `VIDEO_CONSULTATION_ENABLED=false` faz a rota devolver 503
com `code: VIDEO_CONSULTATION_DISABLED` **antes de debitar crédito**. Antes o
médico pagava 2–6 créditos para receber um 500 opaco.

⚠️ Trava no **backend**, não só na UI: o APK instalado carrega bundle antigo e
continua mostrando o botão.

**Pendente:** solução de vídeo própria na VPS, sem AWS e sem custo por minuto.
Ainda não desenhada — exige brainstorm (SFU self-hosted consome banda e
CPU da VPS, que é compartilhada com outros dois produtos).

### 3. Healthchecks que nunca poderiam passar

`genomaflow-api` marcado `unhealthy` há 6 dias, `FailingStreak` **17.731**, com
a API funcionando. Dois defeitos no mesmo comando: `localhost` resolve `::1`
(a app escuta IPv4) e `/api/auth/me` exige token.

Corrigido: rotas `/api/health` (liveness, não toca em banco) e
`/api/health/ready` (readiness com timeout de 2s por check). Ver
`feedback_healthcheck_honesto.md`.

### 4. CI entregando num lugar que não existe

`deploy.yml` fazia build → ECR → ECS e disparava em push para `main`. Reescrito
para entregar na VPS por SSH, preservando os 4 gates de teste e o
`concurrency`. **Faltam os segredos** `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`,
`VPS_HOST` e alinhar a branch da VPS com a `main`.

### 5. `NODE_TLS_REJECT_UNAUTHORIZED=0` sem motivo

Vinha da era AWS (CA self-signed do RDS, decisão PR15 em
`project_audit_2026_05_10_decisions.md`). Na VPS o Postgres é contêiner na rede
interna com `sslmode=disable` — o flag não protege banco nenhum, só desliga
verificação de certificado nas saídas para Stripe, Anthropic, Z-API e SMTP.
Removido do template.

⚠️ **Ainda está no `.env` que roda na VPS** — sai no próximo deploy.

---

## Estado das pendências

| Pendência | De quem | Situação |
|---|---|---|
| Criar zona DNS na Hostinger + trocar NS no registro.br | usuário | **bloqueia tudo**, prazo 31/08 |
| Cadastrar os 3 segredos da VPS no GitHub | usuário | CI não entrega sem isso |
| Merge `feat/vps-migration` → `main` e produção passar a rodar `main` | a decidir | armadilha nº 2 do DEPLOY.md |
| Remover `NODE_TLS_REJECT_UNAUTHORIZED=0` do `.env` da VPS | próximo deploy | — |
| Smoke test dos 3 módulos depois que o DNS voltar | — | nada foi exercitado em 3 meses |
| Endpoint de trial da FazGo | 4 decisões de produto antes | ver `project_prospeccao_fazgo.md` |
| Vídeo sem AWS | brainstorm | não desenhado |

Ver também: [[project_prospeccao_fazgo]], `../DEPLOY.md`,
`project_aws_cost_reduction.md`.
