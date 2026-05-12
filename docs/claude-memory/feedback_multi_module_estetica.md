---
name: Multi-módulo — incluir 'estetica' em condicionais human
description: Ao adicionar `@if (module === 'human')` ou `if (module === 'human')`, SEMPRE incluir `|| 'estetica'`. Estetica usa subject_type='human'. Incidente 2026-05-12 — cadastro paciente form vazio + backend caindo no fluxo veterinary (species required).
type: feedback
---

# Multi-módulo — incluir 'estetica' em condicionais human (OBRIGATÓRIO)

**Regra:** quando o código tem `if (module === 'human') {...}` ou `@if (user.module === 'human')`, sempre estender para `if (module === 'human' || module === 'estetica')` UNLESS há razão específica para tratar estética de forma diferente (campos exclusivos, fluxo distinto).

**Why:** estetica trata humanos. `subjects.subject_type = 'human'` para ambos `human` e `estetica`. As clínicas estéticas atendem PESSOAS — só o contexto da clínica (módulo) muda, não a natureza do sujeito.

**How to apply:**
- Em validações de payload backend que diferenciam human vs veterinary, agrupar `human` + `estetica` na mesma rotina.
- Em condicionais de template Angular que escolhem entre "campos humanos" e "campos animais", agrupar `human` + `estetica`.
- Em comportamentos verdadeiramente exclusivos (ex: análise IA estética só pra `estetica`), gate via `module === 'estetica'` explícito — não confundir.

## Padrão correto

### Backend
```js
// ✅ CORRETO
if (module === 'human' || module === 'estetica') {
  // valida name + birth_date + sex
  // INSERT INTO subjects ... subject_type='human'
} else {
  // veterinary: name + sex + species
  // INSERT ... subject_type='animal'
}

// ❌ ERRADO — estetica cai no else (vet) e falha exigindo species
if (module === 'human') {
  // ...
}
// implicit else → vet logic
```

### Frontend Angular
```html
<!-- ✅ CORRETO -->
@if (user.module === 'human' || user.module === 'estetica') {
  <!-- campos humanos -->
}
@if (user.module === 'veterinary') {
  <!-- campos animais -->
}

<!-- ❌ ERRADO — estetica não renderiza nada -->
@if (user.module === 'human') { ... }
@if (user.module === 'veterinary') { ... }
```

### Cor textual / labels
Textos como "tutor / dono / animal" vs "paciente / responsável legal" também precisam considerar estetica como "humano":
```ts
const ownerLabel = (module === 'veterinary') ? 'O tutor' : 'O paciente (ou responsável legal)';
// ✅ Cobre human + estetica via else implícito
```

## Comportamentos verdadeiramente exclusivos de 'estetica'

Quando devem ser gated `module === 'estetica'` específico (não compartilhar com 'human'):

1. **Aba "Análise Estética IA"** no patient-detail
2. **Aba "Perfil Estético"** (TMB + nutrição)
3. **`requireEsteticaModule` middleware** em rotas `/aesthetic/*`
4. **Cards landing page** específicos do produto estético

Para o resto, agrupar com `human`.

## Incidente 2026-05-12 — referência forense

Esteticista clica em "+ Novo paciente" → modal abre mostrando APENAS o checkbox "Consentimento LGPD". Sem nome, data de nascimento, sexo, telefone. Submit falha com `name, sex and species are required`.

**Causa dupla:**

1. `apps/web/src/app/features/doctor/patients/patient-list.component.ts:307,379`:
```html
@if (user.module === 'human') { /* campos humanos */ }
@if (user.module === 'veterinary') { /* campos animais */ }
```
Para `module === 'estetica'`: nenhum dos dois `@if` matched → form rendeu vazio.

2. `apps/api/src/routes/patients.js:178`:
```js
if (module === 'human') {
  // valida + INSERT subject_type='human'
}
// fallthrough → vet branch que exige species
```
Para `module === 'estetica'`: fallthrough no else → "species required" 400.

**Fix mergeado:** commit `10fff60` adicionou `|| 'estetica'` em ambas as camadas + teste source-inspection (4 tests) `tests/routes/patients-estetica.test.js` para garantir regression-proof.

## Onde mais verificar

Auditoria sugerida (não foi feita em F1-F6 porque o flow padrão sempre dispara via módulo estetica diretamente — esse bug específico só apareceu agora porque cadastro de paciente NÃO faz parte do flow aesthetic-specific):

```bash
# Procura por condicionais que filtram human sem cobrir estetica
grep -rn "module === 'human'\|module === \"human\"" apps/api/src apps/web/src
# Para cada hit, verificar: cobre estetica? Senão, adicionar.
```

## Anti-pattern a evitar

❌ Tratar estetica como módulo "veterinário-like" porque o código já tem human/vet duality.
❌ Criar branch `module === 'estetica'` separada que duplica a lógica human (gera divergência).
✅ Agrupar `human || estetica` quando o comportamento é o mesmo (que é o caso na maioria das vezes).
✅ Gated `=== 'estetica'` apenas para features que SÓ existem no produto estético (análise IA estética, perfil nutricional, consent reforçado, etc.).
