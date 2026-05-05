---
name: Validação de telefone BR — DDD obrigatório
description: Validador shared backend+frontend (apps/api/src/utils/phone.js + apps/web/src/app/shared/utils/mask.ts) com DDD obrigatório, lista oficial Anatel, regra de celular com 9 inicial e fixo com 2-5
type: feedback
originSessionId: 77d452f4-2c27-4cf7-9b25-4d53aa31e410
---
Demanda 2026-05-05: telefones cadastrados sem DDD quebram WhatsApp + SMS. Implementada validação compartilhada que exige DDD em todos os campos de telefone do app.

## Where applied

**Backend** (`apps/api/src/utils/phone.js`):
- `validatePhoneBR(value)` — boolean
- `normalizePhoneBR(value)` — retorna E.164 sem `+` (formato Z-API), ou null
- `VALID_DDDS` — Set com 67 DDDs ativos (Anatel)

Routes que validam (helper `checkPhone(value, label)` em `patients.js`):
- `POST/PUT /patients/owners` — `phone` do tutor
- `POST/PUT /patients` — `phone` do paciente + `emergency_contact_phone`
- `PUT /clinic/profile` — `phone` + `whatsapp_phone`

**Frontend** (`apps/web/src/app/shared/utils/mask.ts`):
- `isValidPhoneBR(value)` — mirror do backend
- `formatPhone(value)` — máscara automática `(00) 00000-0000`

Forms aplicados:
- `patient-list.component.ts` — owner form + patient form (mat-error inline + bloqueia submit)
- `patient-detail.component.ts` — `editForm.phone` (mat-error inline + bloqueia saveProfile)
- `clinic-profile-modal.component.ts` — `phone` + `whatsappPhone` (mat-error inline + bloqueia save)

## Regras

Aceita:
- 11 dígitos: DDD + celular com 9 → `(11) 99999-9999`
- 10 dígitos: DDD + fixo → `(11) 3333-4444`
- 12-13 dígitos: com DDI 55 → `5511999999999`
- Pontuação livre: parênteses, traços, espaços, +
- **Vazio = válido** (campo opcional — caller usa Validators.required separado se exigir)

Rejeita:
- <10 dígitos (sem DDD)
- DDD inválido (não está nos 67 oficiais Anatel)
- Celular (11 dígitos local) sem `9` no terceiro dígito
- Fixo (10 dígitos local) começando com 0, 1, 6+
- DDI errado (não 55)

## Mensagem padrão de erro

Sempre `"Use formato com DDD: (11) 99999-9999"` em backend e frontend (consistente).

## Padrão pra novos campos de telefone

Toda nova rota que aceita `phone`:
1. Backend: importa `validatePhoneBR` e usa via helper `checkPhone(value, 'Label legível')` que retorna string de erro ou null
2. Frontend: importa `isValidPhoneBR` em mat-form-field com `@if` mostrando `<mat-error>` + bloquear submit no método save()

Tests: `apps/api/tests/services/phone-validation.test.js` (32 cases — modelo pra extender quando adicionar DDDs ou regras).

Padrão é **defensivo (rejeita)** — se cliente reclamar de falso negativo, é melhor que falso positivo (telefone errado vira problema de WhatsApp/SMS sem volta).

## Backwards compat

Cadastros legados com phone inválido **não são afetados** — só validamos no INSERT/UPDATE. Vai falhar só se usuário tentar editar e salvar de novo. Decisão consciente: melhor cliente arrumar manualmente do que apagar dados silenciosamente.
