---
name: Validação CPF/CNPJ via dígitos verificadores (módulo 11)
description: Validador shared backend+frontend (apps/api/src/utils/documents.js + apps/web/src/app/shared/utils/mask.ts) com algoritmo módulo 11 oficial. Aceita CPF (11) ou CNPJ (14) onde for tutor (PF/PJ); CPF onde for paciente; CNPJ onde for clínica
type: feedback
originSessionId: 77d452f4-2c27-4cf7-9b25-4d53aa31e410
---
Demanda 2026-05-05: rejeitar CPFs/CNPJs digitados errado (não só formato/length). Algoritmo módulo 11 oficial pra dígitos verificadores.

## Where applied

**Backend** (`apps/api/src/utils/documents.js`):
- `validateCPF(value)` — 11 dígitos + 2 DVs. Rejeita sequências (000...000)
- `validateCNPJ(value)` — 14 dígitos + 2 DVs com pesos `[5,4,3,2,9,8,7,6,5,4,3,2]` e `[6,5,4,3,2,9,8,7,6,5,4,3,2]`
- `validateCpfOrCnpj(value)` — aceita ambos (PF ou PJ)

Routes:
- `patients.js POST /owners` — `checkCpfOrCnpj(cpf, 'CPF/CNPJ do tutor')` (tutor pode ser PF ou PJ)
- `patients.js POST /patients` — `checkCPF(cpf, 'CPF do paciente')` (paciente é sempre PF)
- `clinic.js PUT /profile` — `validateCNPJ(cnpj)` (clínica é PJ)

**Frontend** (`apps/web/src/app/shared/utils/mask.ts`):
- `isValidCPF(value)`, `isValidCNPJ(value)`, `isValidCpfOrCnpj(value)` — mirrors do backend
- `formatCnpj(value)` — máscara automática `00.000.000/0000-00`

Forms aplicados:
- `patient-list.component.ts` owner form: label "CPF ou CNPJ" + máscara dinâmica (`onCpfOrCnpjInput`: ≤11 dígitos = CPF, >11 = CNPJ)
- `patient-list.component.ts` patient form: máscara CPF
- `clinic-profile-modal.component.ts`: máscara CNPJ + bloqueio submit
- Todos com mat-error inline e bloqueio submit no save()

## Regras

Aceita:
- CPF válido (11 dígitos com DVs corretos)
- CNPJ válido (14 dígitos com DVs corretos)
- Vazio = válido (campo opcional)

Rejeita:
- Sequências (000...000, 111...111, etc — falha clássica de CPFs gerados aleatoriamente)
- Comprimento errado (10, 12, 13 dígitos)
- DVs incorretos (último ou penúltimo)
- Tipos errados (number em vez de string)

## Algoritmo (referência)

**CPF (11 dígitos):**
- Reject all-equal: `^(\d)\1{10}$`
- 1º DV: soma 9 primeiros × peso (10..2). Se `(soma * 10) % 11 === 10` → 0; senão → resto. Compara com dígito 10
- 2º DV: soma 10 primeiros × peso (11..2). Mesmo cálculo. Compara com dígito 11

**CNPJ (14 dígitos):**
- Reject all-equal: `^(\d)\1{13}$`
- 1º DV: pesos `[5,4,3,2,9,8,7,6,5,4,3,2]` × 12 primeiros. `resto = soma % 11`. Se resto < 2 → 0; senão → 11 - resto. Compara com dígito 13
- 2º DV: pesos `[6,5,4,3,2,9,8,7,6,5,4,3,2]` × 13 primeiros. Mesmo cálculo. Compara com dígito 14

## Mensagens padrão

- Tutor: `"CPF/CNPJ do tutor inválido. Verifique os dígitos."`
- Paciente: `"CPF do paciente inválido. Verifique os dígitos."`
- Clínica: `"CNPJ inválido. Verifique os dígitos."`

## Padrão pra novos campos

Mesmo princípio do telefone:
1. Backend: helper `checkCPF` / `checkCNPJ` / `checkCpfOrCnpj` retorna string de erro ou null
2. Frontend: importar `isValidXXX` + mat-error inline + bloqueio submit

Tests: `apps/api/tests/services/documents-validation.test.js` (34 cases). CNPJ real do GenomaFlow `64.052.716/0001-15` (CLAUDE.md) usado como sample válido.

## Backwards compat

Idem ao phone — cadastros legados com CPF/CNPJ inválido não são afetados. Validação só em INSERT (POST). PUT existente nas rotas atuais NÃO atualiza CPF/CNPJ (intencional — campos imutáveis após cadastro).
