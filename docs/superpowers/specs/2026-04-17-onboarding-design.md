# GenomaFlow — Onboarding de Novos Tenants

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar o fluxo de cadastro de novas clínicas — wizard de 4 etapas em `/onboarding` no Angular app, com backend `POST /auth/register`, finalizando no redirect para o gateway de pagamento.

**Architecture:** Componente Angular standalone com estado local gerenciado por propriedades (sem NgRx). Quatro etapas renderizadas condicionalmente via `@switch (step)`. Backend adiciona rota pública `POST /auth/register` que cria tenant + usuário admin e retorna `tenant_id` para o gateway incluir no `metadata` do pagamento. Em desenvolvimento, botão "Simular pagamento aprovado" ativa a conta sem gateway real.

**Tech Stack:** Angular 17+, Fastify (nova rota), PostgreSQL, Stripe SDK / Mercado Pago SDK (apenas criação de checkout — webhooks já spec'd no billing design), bcrypt.

---

## 1. Backend — `POST /auth/register`

**Arquivo:** `apps/api/src/routes/auth.js` (novo endpoint no mesmo arquivo)

**Body:**
```json
{
  "clinic_name": "Clínica São Lucas",
  "email": "admin@saolucas.com.br",
  "password": "senhasegura123",
  "module": "human"
}
```

**Fluxo:**
1. Valida campos obrigatórios (clinic_name, email, password, module)
2. Verifica se email já existe em `users`
3. Cria tenant: `INSERT INTO tenants (name, type, module) VALUES ($1, 'clinic', $2)`
4. Cria usuário admin: `INSERT INTO users (tenant_id, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`
5. Retorna `{ tenant_id, user_id, email }` — sem JWT ainda (conta não ativa até pagamento)

**Resposta de erro se email duplicado:** `409 { error: 'Email já cadastrado' }`

---

## 2. Backend — `POST /auth/activate` (pós-pagamento simulado)

Usado apenas em desenvolvimento para ativar conta sem gateway real:

**Body:** `{ tenant_id: string }`

**Fluxo:** Marca tenant como ativo (coluna `active BOOLEAN DEFAULT false` — ver migration 015). Retorna `200 OK`.

**Em produção:** Este endpoint não existe — ativação ocorre via webhook do gateway.

---

## 3. Migration 015 — `tenants.active`

```sql
-- apps/api/src/db/migrations/015_tenant_active.sql
ALTER TABLE tenants
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT false;

-- Tenants existentes já são considerados ativos
UPDATE tenants SET active = true;
```

O middleware de autenticação (`apps/api/src/plugins/auth.js`) verifica `t.active = true` ao fazer login — retorna `403 { error: 'Conta pendente de ativação' }` se falso.

---

## 4. Frontend — Rota `/onboarding`

**Arquivo:** `apps/web/src/app/features/onboarding/onboarding.component.ts`

**Registrar na rota:** `apps/web/src/app/app.routes.ts`
```typescript
{ path: 'onboarding', component: OnboardingComponent }
```
Rota pública (sem guard de autenticação).

### Step 1 — Dados da Clínica

Campos:
- Nome da clínica (obrigatório)
- Email do administrador (obrigatório, validar formato)
- Senha (obrigatório, mínimo 8 caracteres)
- Confirmar senha (obrigatório, deve ser igual)

Botão: "Continuar" — valida campos e avança para Step 2.

### Step 2 — Seleção de Módulo

Dois cards grandes:
- **Clínica Humana** — ícone `local_hospital` + "Medicina humana: metabólico, cardiovascular, hematologia"
- **Clínica Veterinária** — ícone `pets` + "Medicina veterinária: pequenos animais, equinos, bovinos"

Aviso: "Esta seleção é permanente após o cadastro."

Botão: "Continuar" — avança para Step 3.

### Step 3 — Especialidades

Checkboxes das especialidades disponíveis conforme módulo selecionado:

**Módulo Humano:**
- Metabólico
- Cardiovascular
- Hematologia
- Terapêutico (síntese — fase 2)
- Nutrição (síntese — fase 2)

**Módulo Veterinário:**
- Pequenos Animais (cão/gato)
- Equinos
- Bovinos
- Terapêutico (síntese — fase 2)
- Nutrição (síntese — fase 2)

Estimativa dinâmica: "Com X especialidades, cada exame consome X créditos."

Mínimo 1 especialidade obrigatória.

Botão: "Continuar" → chama `POST /auth/register`, armazena `tenant_id` em memória, avança para Step 4.

### Step 4 — Plano e Pagamento

**Card fixo — Assinatura:**
```
ASSINATURA MENSAL
R$ 199,00/mês
```

**Banner promoção:**
```
✦ OFERTA DE BOAS-VINDAS
Primeiro mês: ~122 créditos grátis
(30% de R$ 199,00 convertidos em créditos)
```

**Seleção de gateway:**
- Cartão de crédito (Stripe)
- PIX / Boleto (Mercado Pago)

**Botão "Ir para pagamento"** → chama `POST /billing/subscribe` (gateway selecionado, plan="starter") → redireciona para URL do checkout do gateway.

**Em desenvolvimento** (variável `environment.production === false`):
- Botão adicional "Simular pagamento aprovado" → chama `POST /auth/activate` → redireciona para `/login?activated=true`

---

## 5. Pós-pagamento

Webhook do gateway (`POST /webhooks/stripe` ou `POST /webhooks/mercadopago`) ao confirmar `subscription_created`:
1. Marca `tenants.active = true`
2. Insere em `credit_ledger`: bônus de boas-vindas (~122 créditos, kind='subscription_bonus')
3. Insere em `tenant_specialties` as especialidades selecionadas (armazenadas no `metadata` do checkout)

**Redirect pós-pagamento** (URL de retorno configurada no gateway):
`APP_URL/login?activated=true`

Na tela de login, se `?activated=true`, exibe banner:
```
✅ Conta ativada! Seus créditos de boas-vindas já estão disponíveis.
```

---

## 6. Middleware de auth — verificação `active`

Em `apps/api/src/plugins/auth.js` (ou `apps/api/src/routes/auth.js` no login):

```js
// No login, após validar senha:
if (!user.active) {
  return reply.status(403).send({ error: 'Conta pendente de ativação. Verifique seu pagamento.' });
}
```

A query de login passa a incluir `t.active` no JOIN com tenants.

---

## 7. Armazenamento de especialidades no checkout

Ao criar o checkout no gateway, incluir no `metadata`:
```json
{
  "tenant_id": "uuid",
  "specialties": ["metabolic", "cardiovascular", "therapeutic"]
}
```

O webhook lê esse metadata para inserir em `tenant_specialties`.

---

## Fora de Escopo

- Recuperação de senha
- Confirmação por email
- Onboarding de usuários adicionais (lab_tech, doctor) — feito pelo admin dentro do app
- Plano Pro ou tiers além do Starter
- CNPJ / validação fiscal
