---
name: Credenciais master GenomaFlow (rodrigonoma)
description: Login do usuário master (role='master') está em AWS Secrets Manager. Use quando precisar fazer ops admin via API (criar tenant manual, impersonate, audit log, etc.).
type: reference
---

# Credenciais master pra ops admin via API

**Não armazenar senha em texto plano em nenhum arquivo do repo.**

## Onde fica

AWS Secrets Manager:
- Name: `/genomaflow/prod/master-credentials`
- ARN: `arn:aws:secretsmanager:us-east-1:981207388012:secret:/genomaflow/prod/master-credentials-gULUpt`
- Region: `us-east-1`
- Conteúdo: JSON `{ "email": "rodrigo.noma@genomaflow.com.br", "password": "..." }`

## Como acessar (Node + AWS SDK)

```js
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const c = new SecretsManagerClient({ region: 'us-east-1' });
const r = await c.send(new GetSecretValueCommand({ SecretId: '/genomaflow/prod/master-credentials' }));
const { email, password } = JSON.parse(r.SecretString);
```

Credenciais AWS pra acessar: em `aws/credentials` (gitignored) ou env vars
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

## Quando usar

Quando o usuário pedir uma operação de master via API (criar tenant manual,
grant créditos via /master/credits, impersonate, query audit log, etc.) e
não houver caminho via UI já existente.

Para criar tenant manual: usar endpoint `POST /master/tenants` documentado
em `apps/api/src/routes/master.js:246`. Body suporta: `clinic_name`, `email`,
`password`, `module` (human|veterinary|estetica), `professional_type`,
`initial_credits`, `mark_email_verified` (default true), `accept_all_terms`
(default true), `active` (default true), `require_password_change` (default
true — setar false pra demo se senha fixa for desejada).

## Rotação

Trocar senha do master:
1. Login no app com nova senha (via UI) ou rodar UPDATE direto via ECS one-shot
2. `aws secretsmanager update-secret --secret-id /genomaflow/prod/master-credentials --secret-string '{"email":"...","password":"..."}'`

## Histórico

- Criado 2026-05-11 (sessão que criou contas demo Mario Borges)
- Decisão do usuário: salvar pra evitar repassar senha em toda sessão
