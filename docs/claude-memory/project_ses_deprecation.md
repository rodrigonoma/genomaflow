---
name: AWS SES sendo descontinuado — substituir provider de email
description: Decisão 2026-05-11 — AWS SES nunca saiu do sandbox (production access pendente desde 2026-04-24). Phased out. Próximo passo: escolher novo provider OU mover features pra WhatsApp.
type: project
---

# AWS SES — decisão de descontinuar (2026-05-11)

## Estado atual

- **AWS SES sandbox** desde 2026-04-24 (pedido de production access enviado
  na mesma data, **nunca aprovado**)
- Em sandbox: só envia pra emails pré-verificados via
  `aws sesv2 create-email-identity`
- Domínio `genomaflow.com.br` está verificado (DKIM + SPF + DMARC via Route53)
- SNS bounce/complaint handler já implementado mas **inútil enquanto em sandbox**
  (sem fluxo real de bounces pra processar)

## Por que descontinuar

- 18+ dias sem aprovação de production access
- AWS é opaco sobre os critérios — pode demorar meses ou nunca aprovar
- Tempo do GenomaFlow é caro pra ficar esperando AWS responder

## Features que dependem de SES hoje

1. **Email verification** no onboarding (verificar conta nova)
2. **Password reset** (link single-use 1h)
3. **NPS pós-encontro** (token público via email)
4. **Email transacional genérico** (recibos, confirmações)
5. **SES bounce/complaint** via SNS webhook (`/webhooks/ses`)

## Caminhos possíveis (não decididos ainda)

### A) Trocar provider de email (recomendado)

Substitui SES por outro SaaS de email transacional. **Mantém todas as
features funcionando** sem mudança de UX. Candidatos:

- **Resend** — moderno, dev-friendly, free tier 3k emails/mês, ótima DX.
  Bem visto pela comunidade dev BR.
- **Postmark** — transacional-focused, deliverability conhecida, ~$10/mês.
- **Mailgun** — tradicional, free tier 5k emails/mês.
- **Brevo** (ex-Sendinblue) — free tier 300 emails/dia, sediado UE.

**Esforço estimado:** 1-2 dias. Tocar `mailer.js`/`ses-client.js`,
trocar SDK, atualizar env vars no CDK, remover SES IAM, remover
SNS bounce webhook (cada provider tem seu próprio formato).

### B) Mover features críticas pra WhatsApp (Z-API já ativo)

Já temos Z-API rodando pra lembretes/follow-ups. Poderia ser usado pra:
- Password reset via link no WhatsApp
- Verificação de conta via código no WhatsApp
- NPS no WhatsApp em vez de email

**Trade-off:** exige número WhatsApp do usuário no signup (hoje é
opcional). Quebra UX de quem não usa WhatsApp.

### C) Híbrido — Z-API pro Brasil + provider de email pra fallback

Ideal mas mais complexo. Z-API é o caminho principal (90% dos usuários
brasileiros); email só pra quem não tem WhatsApp ou recusou.

## Decisão deferida

Usuário ainda não escolheu A/B/C. Próxima sessão sobre o tema deve
começar com brainstorm de personas (PO + UX + Eng Software) pra
recomendar caminho.

## Itens canceladis após esta decisão

- **PR13 (SNS webhook signature validation)** — não hardenar serviço
  sendo phased out. Registrado em
  `project_audit_2026_05_10_decisions.md`.

## Como aplicar (até decisão ser tomada)

1. **NÃO investir mais tempo em SES** — nem PR de hardening, nem
   tentar novamente production access sem novo pedido bem fundamentado.
2. **Tarefas de email novas** → pausar e perguntar qual provider antes
   de implementar.
3. Documentar em CLAUDE.md que SES está deprecado quando a substituição
   estiver planejada.
