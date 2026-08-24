---
name: Prospecção pela plataforma FazGo — o GenomaFlow como produto prospectado
description: A FazGo prospecta clínicas por WhatsApp e precisa que o GenomaFlow crie a conta de teste de 15 dias. Canal pronto e aprovado; falta o endpoint aqui, e ele exige 4 decisões de produto antes do código.
type: project
---

O **FazGo** (`app.fazgo.com.br`, mesmo dono) é uma plataforma de prospecção: acha
negócios, qualifica, aborda por WhatsApp e e-mail, entrega uma oferta e acompanha
se a pessoa começou a usar. O **GenomaFlow é o segundo produto prospectado por
ela** — o primeiro é o Informatizou.

O que a FazGo faz sozinha já está pronto e em produção. O que falta é **deste
lado**: um endpoint que crie a conta de teste quando um prospect aceita.

---

## O fluxo, ponta a ponta

1. A FazGo encontra a clínica e manda uma mensagem de WhatsApp (template
   aprovado na Meta — ver abaixo).
2. A clínica responde. Um atendente automático conversa, usando um roteiro
   escrito especificamente para o GenomaFlow.
3. Se a pessoa quer testar, o atendente pede o e-mail dela.
4. A FazGo chama **o nosso endpoint** para criar a conta de teste.
5. **Só depois de receber o link de acesso** é que ela manda o link para o
   prospect.

A ordem do passo 5 é regra da FazGo: ela **nunca promete acesso antes de o
acesso existir**. Se o nosso endpoint falhar, o prospect não recebe link nenhum —
a conversa vai para um humano e um alarme dispara lá. Nunca sai link quebrado.

---

## O que já está pronto do lado da FazGo (23/08/2026)

- **Canal de WhatsApp.** O GenomaFlow fala pelo **mesmo número** do Informatizou.
  A FazGo separa as conversas por produto internamente (quem falou com a pessoa
  por último fica com a mensagem).
- **Templates aprovados na Meta:** `genomaflow_prospeccao_a` e
  `genomaflow_prospeccao_b` (teste A/B). Usam botão de resposta rápida, **não
  botão de link** — porque `genomaflow.com.br` **não resolvia DNS nenhum** em
  23/08 (sem registro A, sem NS).
- **Roteiro do atendente** configurado: descreve agenda, prontuário, prescrição e
  leitura de laudo em PDF. **Não fala preço** (a grade não está escrita em lugar
  citável) e **não promete resultado clínico** — a leitura de exame é sempre
  apresentada como material para o profissional conferir e decidir.

---

## O que falta AQUI, e por que não é mecânico

**Spec completa:** `docs/superpowers/specs/2026-08-23-provisionamento-trial-plataforma-design.md`

A leitura do nosso código em 22/08 mostrou duas ausências que não são detalhe de
implementação:

1. **Não existe conceito de trial.** Zero ocorrências de `trial` em
   `apps/api/src`. Hoje `billing_status` assume `active`, `past_due` e
   `pending_payment`, e um tenant só nasce em
   `handleOnboardingSubscriptionCompleted` — **depois de o Stripe confirmar
   pagamento**. Foi decisão explícita (Option E, 2026-05-04), para não deixar
   órfão no banco quando alguém desiste.

2. **Não existe acesso sem senha.** O contrato exige um link de primeiro acesso
   que abre sem senha. `auth.js` e `auth-email.js` não têm magic link nem token
   de convite. O único "convite" do sistema é o do inter-tenant-chat, que é outra
   coisa.

Construir isso é inventar **um estado de cobrança novo e um caminho de
autenticação novo num sistema de produção que guarda prontuário**.

### As 4 decisões que vêm antes do código

- **D1. O que acontece no dia 16?** A clínica pode ter cadastrado pacientes e
  prontuários reais. Recomendação da spec: **bloquear o acesso e manter o dado** —
  é a única opção cujo pior caso é pagar armazenamento. As outras têm pior caso
  que envolve o paciente de alguém ou a fatura de alguém. ⚠️ Retenção e exclusão
  pós-trial precisam estar no termo de uso **antes** do primeiro trial existir.
- **D2. Quantos créditos o trial recebe?** As funcionalidades de IA consomem
  `credit_ledger`. Trial sem teto é conta da Anthropic aberta para quem preencher
  um formulário — e a FazGo existe para gerar muitos desses.
- **D3. Como o link de primeiro acesso se comporta?** Ele dá acesso de admin a
  uma clínica, sem senha, chegando por WhatsApp. Assuma que vaza: token ≥32
  bytes guardado **como hash**, uso único, expiração curta (72h, não 15 dias),
  registro em `audit_log`.
- **D4. De onde sai `module`?** ⚠️ **Incompatibilidade concreta:** o contrato
  manda `categoria` como slug do Google **em inglês** (`beauty_salon`,
  `veterinary_care`), e criar tenant aqui exige `module` +
  `professional_type` + `specialties`. Recomendação: deduzir por um mapa
  explícito, cair num padrão seguro, **logar o que não reconheceu**, e deixar a
  troca de módulo fácil na primeira tela.

---

## O contrato, resumido

```http
POST {url que você cadastrar na FazGo}
Authorization: Bearer {segredo que VOCÊ emite}

{ "leadId": "...", "email": "...", "nome": "...", "telefone": "...",
  "negocio": { "nome": "...", "cidade": "...", "categoria": "beauty_salon" },
  "trialDias": 15 }
```

Resposta esperada: `{ contaId, urlAcesso, expiraEm }`.

⚠️ **Idempotente por `leadId`** — a segunda chamada com o mesmo `leadId` tem de
devolver a MESMA conta. Retentativa de fila é normal (rede, deploy, timeout de
10s). Sem isso, um prospect vira duas clínicas, e isso aparece na fatura.

⚠️ **200 sem `urlAcesso` é tratado como FALHA** do lado de lá. Nunca responder
200 sem o link pronto.

⚠️ Timeout do chamador é **10 segundos**, com 3 tentativas apenas em falha de
rede. Trabalho pesado (e-mail de boas-vindas, seed) vai para fila.

⚠️ **`billing_status = 'trialing'` é a parte com maior chance de deixar buraco.**
Todo lugar que hoje compara com `'active'` para liberar acesso precisa ser
revisto — liberar demais não dá erro em lugar nenhum. Fazer
`grep -rn "billing_status" apps/` antes de começar, e um teste por ponto achado.

---

## Também pendente (fora do código)

- **`genomaflow.com.br` não resolve DNS** (sem A, sem NS — verificado 23/08). A
  produção está na AWS e o domínio não está delegado. Enquanto isso, nenhum link
  público do GenomaFlow funciona.
- **Domínio verificado no Resend** para a FazGo mandar e-mail de prospecção como
  GenomaFlow. Hoje o domínio está verificado no **SES** (Route53), que é outro
  provedor.

Ver também: `project_context.md`, `project_stripe_integration.md`.
