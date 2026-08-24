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

### 1. DNS morto — RESOLVIDO em 24/08/2026

Não era falta de registro `A`. O **registro.br delegava** o domínio para 4
nameservers do **Route 53** que respondiam `REFUSED`. RDAP:
`delegation check 2026-08-21 → "ns query refused"`, última correta
**13/07/2026** — quebrado há ~6 semanas.

⚠️ **A zona NÃO foi apagada no cleanup** — ela foi preservada de propósito
(`project_aws_cost_reduction.md`: stack `genomaflow-dns`, 16 registros).
Somando com as credenciais AWS inválidas em dois lugares independentes
(máquina local e contêiner na VPS), a hipótese é que a **conta AWS foi
encerrada ou suspensa** depois de 02/06. Se for isso, os snapshots de RDS
retidos "para rollback" foram junto.

**Corrigido:** zona movida para o DNS do próprio registro.br (delegação agora
em `d.sec.dns.br` / `e.sec.dns.br`), 6 registros A para `2.25.163.251`.

⚠️ **Registros de e-mail do Zoho (MX/SPF/DKIM/DMARC) foram embora com a zona** e
precisam ser recriados a partir do console do Zoho — sem eles, e-mail
transacional (verificação, reset de senha, NPS) cai em spam.

**Certificado:** renovado em 24/08, válido até **22/11/2026**.

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

### 2b. Caddy entregando tráfego do GenomaFlow para o Auditty

Descoberto assim que o DNS voltou: 502 nos quatro domínios e
`s3.genomaflow.com.br` servindo o MinIO do Auditty. O Caddy está em duas redes
Docker e os nomes `api`/`web`/`minio` resolviam para os contêineres do
vizinho. Corrigido para nome de contêiner. Sem vazamento de dado (403 anônimo;
URL pré-assinada carrega assinatura, não chave). Lição completa em
[[feedback_docker_alias_colisao_redes]].

⚠️ **Disco encheu em 17/08** (`no space left on device` ao gravar locks do
CertMagic) — foi o que travou a renovação do certificado junto com o DNS morto.
Hoje está em 49% e o Docker tem rotação de log configurada; a causa daquele pico
não foi determinada. Vale um alarme de disco na VPS.

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
| ~~DNS~~ | — | ✅ resolvido 24/08 via DNS do registro.br |
| Recriar MX/SPF/DKIM/DMARC do Zoho na zona nova | usuário | e-mail transacional em spam sem isso |
| Cadastrar os 3 segredos da VPS no GitHub | usuário | CI não entrega sem isso |
| Merge `feat/vps-migration` → `main` e produção passar a rodar `main` | a decidir | armadilha nº 2 do DEPLOY.md |
| Remover `NODE_TLS_REJECT_UNAUTHORIZED=0` do `.env` da VPS | próximo deploy | — |
| Smoke test dos 3 módulos depois que o DNS voltar | — | nada foi exercitado em 3 meses |
| Endpoint de trial da FazGo | 4 decisões de produto antes | ver `project_prospeccao_fazgo.md` |
| Vídeo sem AWS | brainstorm | não desenhado |

Ver também: [[project_prospeccao_fazgo]], `../DEPLOY.md`,
`project_aws_cost_reduction.md`.
