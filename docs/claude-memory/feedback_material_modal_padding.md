---
name: Material Dialog — floating label clipada em modais com scroll
description: modal-body com overflow-y:auto + padding-top:0 clipa o floating label do mat-form-field appearance="outline"; usar padding: 1.25rem 1.5rem
type: feedback
---

`mat-form-field appearance="outline"` posiciona o floating label acima do border via `transform: translateY(-X)`. Se o container ancestral tem `overflow: auto` (ou `hidden`) com `padding-top: 0`, o topo da label cai fora da área visível e aparece cortada.

Sintoma visual: "Nome da Clínica" vira "ome da Clíni" — só a parte inferior da label aparece.

## Padrão certo no projeto

```css
.modal-header { padding: 1.5rem 1.5rem 0; }
.modal-body   { padding: 1.25rem 1.5rem; overflow-y: auto; max-height: 70vh; }
```

O `padding: 1.25rem 1.5rem` no body dá espaço suficiente pra label respirar acima do border do primeiro field. Usado em `prescription-modal.component.ts` e agora em `clinic-profile-modal.component.ts` (commit `85c45695`).

## Padrão errado (antes do fix)

```css
.modal-header { padding: 1.5rem 1.5rem 0; margin-bottom: 1.25rem; }
.modal-body   { padding: 0 1.5rem 1.5rem; overflow-y: auto; }
/*                       ^ padding-top ZERO */
```

O `margin-bottom` no header **não** protege a label do clip — o clip do overflow respeita o content-box do body, não o espaço externo.

**Why:** reportado 2026-04-24 no Screenshot_136 — "o texto do input foi cortado, já ocorreu isso no passado". Rastreado a padding-top:0 combinado com overflow-y:auto no modal body.

**How to apply:**
- Todo `<div class="modal-body">` que contém `mat-form-field` + tem `overflow` deve ter pelo menos `padding-top: 1rem` (preferência: `padding: 1.25rem 1.5rem`).
- Header não resolve o problema com `margin-bottom` — o scroll container corta dentro do seu próprio content-box.
- Se for custom e não puder mudar padding: alternativa é trocar por `appearance="fill"` ou setar `mat-form-field { margin-top: 8px; }` no primeiro field.

**Arquivos relevantes:**
- `apps/web/src/app/features/clinic/profile/clinic-profile-modal.component.ts`
- `apps/web/src/app/features/clinic/prescription/prescription-modal.component.ts` (referência de padrão correto)
