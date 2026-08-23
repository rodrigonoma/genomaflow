---
name: Provisionamento de trial pela plataforma de prospecção
description: Endpoint que cria conta de teste de 15 dias quando a plataforma FazGo fecha um prospect — o que dá para construir e as decisões de produto que faltam
type: spec
---

# Provisionamento de trial pela plataforma de prospecção

**Data:** 2026-08-23
**Estado:** ⚠️ **NÃO IMPLEMENTADO** — este documento existe para tornar as
decisões visíveis antes de alguém escrever código.
**Contrato do outro lado:** já implementado e testado. Vive no repositório do
Informatizou/FazGo em
`docs/superpowers/specs/2026-08-22-contrato-provisionamento-trial.md`.

---

## Por que este documento não é um plano de implementação

A plataforma de prospecção (FazGo) prospecta clínicas, conversa por WhatsApp e,
quando o prospect diz que quer testar, chama **um endpoint do GenomaFlow** para
criar a conta de teste. Só depois de receber o link de acesso é que ela manda
esse link ao prospect — ela nunca promete acesso antes de o acesso existir.

Do lado da plataforma está tudo pronto. Do lado daqui, a leitura do código
mostrou duas ausências que **não são detalhe de implementação**:

1. **Não existe conceito de trial.** Zero ocorrências de `trial` em
   `apps/api/src`. Hoje `billing_status` assume `active`, `past_due` e
   `pending_payment`, e um tenant só nasce em
   `handleOnboardingSubscriptionCompleted` — ou seja, **depois de o Stripe
   confirmar pagamento**. Foi uma decisão explícita (Option E, 2026-05-04) para
   não deixar órfão no banco quando alguém desiste.

2. **Não existe acesso sem senha.** O `urlAcesso` que o contrato exige é um link
   de primeiro acesso que abre sem senha. `auth.js` e `auth-email.js` não têm
   magic link nem token de convite para login. O único `convite` do sistema é o
   do inter-tenant-chat, que é outra coisa.

Construir isso é inventar um estado de cobrança novo e um caminho de
autenticação novo **num sistema de produção que guarda prontuário**. Não é
trabalho mecânico, e as escolhas abaixo mudam o que o software faz com dado de
paciente. Por isso a decisão vem antes do código.

---

## As decisões que faltam

### D1. O que acontece no dia 16?

O trial é de 15 dias. No dia 16, a clínica pode ter cadastrado pacientes,
agendamentos e prontuários reais. As opções não são equivalentes:

| Opção | O que acontece | Custo de estar errado |
|---|---|---|
| **Bloqueia o acesso, mantém o dado** (recomendada) | Login mostra tela de "assine para continuar". Nada é apagado. | Armazenamento de dado que talvez nunca vire receita. |
| Bloqueia e apaga em N dias | Tela de bloqueio + purga agendada, com aviso por e-mail antes. | Apagar prontuário de paciente real. Precisa de aviso inequívoco e prazo, e ainda assim é a opção que mais dói se der errado. |
| Converte em cobrança automática | Vira assinatura no fim do trial. | Cobrar quem não decidiu comprar. Exige cartão no cadastro, o que derruba a conversão que o trial existe para criar. |

**Recomendação:** bloquear e manter. É a única em que o pior caso é pagar
armazenamento — as outras duas têm pior caso que envolve o paciente de alguém
ou a fatura de alguém.

⚠️ **LGPD:** a clínica é controladora dos dados que inseriu; o GenomaFlow é
operador. Retenção pós-trial, prazo de exclusão e como a clínica exporta o que
cadastrou precisam estar no termo de uso **antes** do primeiro trial existir,
não depois.

### D2. Quantos créditos o trial recebe?

As funcionalidades de IA (análise facial 5 créditos, corporal, recomendações)
consomem `credit_ledger`. Um trial sem teto de créditos é uma conta da Anthropic
aberta para qualquer um que preencher um formulário — e a plataforma de
prospecção existe justamente para gerar muitos desses.

O onboarding pago dá `ONBOARDING_BONUS_CREDITS` (bônus de 30%). O trial precisa
de um número próprio, deliberado: alto o suficiente para a pessoa experimentar o
que diferencia o produto, baixo o suficiente para 200 trials não virarem
prejuízo.

**Recomendação:** um `kind` novo no `credit_ledger` (`trial_grant`), com valor
em variável de ambiente para poder ser ajustado sem deploy.

### D3. Como o link de primeiro acesso funciona?

É um link que dá acesso de **admin** a uma clínica, sem senha, chegando por
WhatsApp. O desenho tem que assumir que o link vaza — encaminhado, print,
histórico de conversa.

Mínimo defensável:
- Token aleatório de ≥32 bytes, guardado **como hash** (o banco não pode conter
  a chave de acesso em claro).
- **Uso único**: consumido no primeiro acesso, que força a criação de senha.
- Expiração curta — 72h, não 15 dias. O trial dura 15 dias; o convite, não.
- Sem enumeração: token inválido e token expirado respondem igual.
- Registro em `audit_log` de quem usou, quando e de que IP.

### D4. Qual módulo e quais especialidades?

Aqui há uma incompatibilidade concreta entre os dois lados, e ela precisa ser
resolvida antes de a primeira chamada acontecer.

O contrato da plataforma envia:

```json
{ "leadId": "...", "email": "...", "nome": "...", "telefone": "...",
  "negocio": { "nome": "...", "cidade": "...", "categoria": "beauty_salon" },
  "trialDias": 15 }
```

Mas criar um tenant aqui exige `module` (`human` | `veterinary` | `estetica`),
`professional_type` e `specialties` — e o `/onboarding/checkout` recusa com 400
quando faltam. **A `categoria` que vem é o slug do Google em inglês**
(`beauty_salon`, `dentist`, `veterinary_care`), que não é a mesma coisa.

Dois caminhos:

- **(a)** O endpoint deduz o módulo da categoria do Google, com um mapa
  explícito, e cai num padrão seguro quando não reconhecer. A conta nasce e a
  pessoa entra direto.
- **(b)** A conta nasce "incompleta" e a primeira tela pede módulo e
  especialidade. Menos chute, mais atrito no momento mais frágil do funil.

**Recomendação: (a) com correção fácil** — deduzir, e deixar a troca de módulo
acessível na primeira tela. Chutar errado e ser corrigido em um clique é melhor
do que receber um formulário logo depois de clicar num link do WhatsApp.

⚠️ O mapa categoria→módulo é a parte que envelhece: cada campanha nova da
plataforma pode trazer uma categoria que ele não conhece. Ele precisa **logar o
que não reconheceu**, senão o padrão vira o valor de todo mundo em silêncio.

---

## O que construir, depois de decidido

Assumindo as recomendações acima. Nada aqui é difícil; o que era difícil está
na seção anterior.

### Migração `106_trial_provisioning.sql`

```sql
-- Trial vindo da plataforma de prospecção.
ALTER TABLE tenants ADD COLUMN trial_ends_at TIMESTAMPTZ;

-- Idempotência do contrato: a segunda chamada com o mesmo leadId tem de
-- devolver a MESMA conta. Sem o índice único, retentativa de fila cria duas
-- clínicas e isso aparece na fatura, não no log.
ALTER TABLE tenants ADD COLUMN provisioned_lead_id TEXT;
CREATE UNIQUE INDEX tenants_provisioned_lead_id_key
  ON tenants (provisioned_lead_id) WHERE provisioned_lead_id IS NOT NULL;

-- Convite de primeiro acesso. Guarda o HASH, nunca o token.
CREATE TABLE first_access_tokens (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX first_access_tokens_tenant_idx ON first_access_tokens (tenant_id);
```

`billing_status` ganha o valor `trialing`. Todo lugar que hoje compara com
`'active'` para liberar acesso precisa ser revisto — **é a parte da tarefa com
maior chance de deixar buraco**, porque liberar demais não dá erro em lugar
nenhum. Vale um levantamento de `grep -rn "billing_status" apps/` antes de
começar, e um teste por ponto encontrado.

### Rota `POST /webhooks/plataforma/trial`

- Autentica por `Authorization: Bearer <segredo>`, comparado em **tempo
  constante** com o segredo em variável de ambiente. O segredo é emitido aqui e
  cadastrado no painel da plataforma, onde fica cifrado (AES-256-GCM) e nunca é
  devolvido pela API.
- Rate limit apertado — é rota pública na borda.
- Idempotente por `leadId`: `SELECT` antes, e `ON CONFLICT` no índice único para
  o caso de duas chamadas simultâneas.
- Devolve `{ contaId, urlAcesso, expiraEm }`. **Um 200 sem `urlAcesso` é tratado
  como FALHA do outro lado** — então nunca responder 200 sem o link pronto.
- Timeout do chamador é de **10 segundos**, com 3 tentativas apenas em falha de
  rede. Trabalho pesado (e-mail de boas-vindas, seed) vai para fila; a resposta
  não espera.

### Testes (Jest, `tests/routes/webhooks-plataforma-trial.test.js`)

O que precisa estar coberto, e por quê:

- Segredo errado → 401. Sem segredo → 401.
- Chamada válida cria tenant + user admin + token, e devolve `urlAcesso`.
- **Mesma chamada duas vezes devolve o MESMO `contaId` e não cria segunda
  clínica** — é o requisito que mais importa do contrato inteiro.
- Duas chamadas simultâneas com o mesmo `leadId` → uma clínica só (o índice
  único é quem garante; o teste é quem prova).
- Token de primeiro acesso: funciona uma vez, falha na segunda, falha depois de
  expirado, e token inválido responde igual a token expirado.
- Tenant em `trialing` **não** acessa o que é de assinante pago.
- Categoria do Google desconhecida cai no padrão **e registra log**.

---

## Ordem sugerida

1. Decidir D1–D4 (é conversa, não código).
2. Levantar todos os pontos que comparam `billing_status` e definir o
   comportamento de `trialing` em cada um.
3. Migração + estado `trialing` + gate de acesso, com testes.
4. Token de primeiro acesso, com testes.
5. A rota do webhook, com testes.
6. Cadastrar URL e segredo no painel `/produtos` da plataforma e usar o botão
   **Testar**, que dispara uma chamada real com um lead fictício.

O passo 6 é o que transforma "não funcionou" em "seu endpoint devolveu 500".

---

## Dependências que não são código

Para o Genomaflow ser prospectado de verdade, além deste endpoint:

- **Número de WhatsApp próprio** (WABA + templates aprovados pela Meta). É o de
  maior prazo dos três — começar por ele. A plataforma **recusa** o envio quando
  o produto não tem canal próprio, de propósito: cair no número do Informatizou
  faria o prospect receber mensagem da marca errada, e uma denúncia derrubaria a
  qualidade do número alheio.
- **`genomaflow.com.br` verificado no Resend**, senão não sai e-mail de
  prospecção.
