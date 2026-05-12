---
name: F4 Aesthetic Nutrition + Profile
description: Nutrição + perfil antropométrico estético (entregue 2026-05-11). Migration 095 subjects.aesthetic_profile JSONB + serviços TMB Mifflin-St Jeor + GET/PUT /aesthetic/profile + recommender consome perfil/computa nutrição + frontend aesthetic-profile-form + aba "Perfil Estético" no patient-detail (estetica only).
type: project
---

# F4 — Nutrição + Perfil Antropométrico (entregue 2026-05-11)

Adiciona dados antropométricos do paciente + cálculo de TMB (Mifflin-St Jeor) + recomendações nutricionais ricas geradas pela IA usando valores pré-computados pelo backend (não delega aritmética crítica pro LLM).

## Migration entregue

| Migration | Conteúdo |
|---|---|
| `095_subjects_aesthetic_profile.sql` | `ALTER TABLE subjects ADD COLUMN aesthetic_profile JSONB NOT NULL DEFAULT '{}'`. Aditivo, zero break multi-módulo. Index parcial pra rows com profile preenchido. |

Shape do JSONB (validado na camada de aplicação):
```
{
  height_cm: number (140-220),
  weight_kg: number (35-200),
  age: number (12-100),
  sex: 'F' | 'M',
  activity_level: 'sedentary'|'light'|'moderate'|'active'|'very_active',
  goals: string[] (max 5, ex: 'fat_loss','tone','wellness','mass'),
  allergies: string[] (max 20),
  medical_conditions: string[] (max 20),
  dietary_restrictions: string[] (max 10),
  updated_at: ISO date string
}
```

## Backend entregue

| Componente | Path | Função |
|---|---|---|
| TMB service | `apps/api/src/services/aesthetic-tmb.js` | Mifflin-St Jeor (`computeTMB`, `computeCalories`, `computeMacros`, `computeAll`) + constantes `ACTIVITY_FACTOR`, `GOAL_ADJUSTMENT`. Pure math, exporta whitelists pra reuso |
| Profile service | `apps/api/src/services/aesthetic-profile.js` | `validate` (clamp + whitelist + sanitize string arrays, strip campos extras), `get`, `update` via `withTenant` |
| Profile routes | `apps/api/src/routes/aesthetic-profile.js` | GET/PUT `/aesthetic/profile/:subject_id` sob `requireEsteticaModule`. Retorna `{ profile, computed }` |

## Worker entregue

| Componente | Path | Função |
|---|---|---|
| TMB lib (worker) | `apps/worker/src/lib/tmb.js` | Cópia espelhada de aesthetic-tmb.js (pure math, sem cross-package require). Ambos arquivos devem ficar em sync — se atualizar fórmula, atualizar nos dois |
| Recommender | `apps/worker/src/agents/aesthetic-recommender.js` | Aceita `aestheticProfile` + `computedNutrition`. Injeta no prompt bloco "PERFIL DO PACIENTE" + "CÁLCULO NUTRICIONAL" (com instrução literal "use EXATAMENTE estes valores. NÃO recalcule"). `sanitizeLifestyle` clamp + fallback pra computedNutrition + disclaimer CRN injetado sempre (fail-safe regulatório) |
| Processor | `apps/worker/src/processors/aesthetic-analysis.js` | Fetcha `subjects.aesthetic_profile` antes do recommender (mesmo client/transação). Se preenchido, `computeAll()` server-side. Falha não-fatal (warn + null) |

## Frontend entregue

| Componente | Path | Função |
|---|---|---|
| Profile service | `apps/web/src/app/features/aesthetic/services/aesthetic-profile.service.ts` | `AestheticProfileService` (get/update) + tipos + constantes `ACTIVITY_LEVELS`, `GOAL_OPTIONS`, `DIETARY_OPTIONS` |
| Profile form | `apps/web/src/app/features/aesthetic/components/aesthetic-profile-form.component.ts` | Standalone OnPush + signals. 6 seções (antropometria, atividade, objetivos, restrições, alergias, condições). Painel de TMB/calorias/macros lateral. Disclaimer CRN. Reuse estilo dark master-treatment-catalog |
| patient-detail integration | `apps/web/src/app/features/doctor/patients/patient-detail.component.ts` | Nova aba "Perfil Estético" gated por `auth.currentProfile?.module === 'estetica'`. Paridade multi-módulo preservada (human/vet não veem) |

## Fórmula

**Mifflin-St Jeor BMR:**
- TMB(M) = 10·peso + 6.25·altura − 5·idade + 5
- TMB(F) = 10·peso + 6.25·altura − 5·idade − 161

**Activity factors:** sedentary 1.2 | light 1.375 | moderate 1.55 | active 1.725 | very_active 1.9

**Goal adjustments:** fat_loss 0.80 | tone 0.95 | wellness 1.00 | mass 1.10

**Macros (% calorias):**
- fat_loss / tone: 30P / 40C / 30F
- wellness: 25P / 45C / 30F
- mass: 25P / 50C / 25F

**Hidratação sugerida:** 35ml × peso_kg, clamp 1500-4000 ml/dia
**Exercise:** clamp 0-180 min/dia

## Pipeline atualizado F1→F4

```
[Esteticista] /aesthetic/analyses POST { analysis_type, subject_id, photo_ids[] }
       ↓ Pre-flight (consent + créditos + photos)
       ↓ Enqueue BullMQ
[Worker]
       ↓ pickAgent(analysis_type) → analyzeFacial OR analyzeBody (Sonnet Vision)
       ↓ fetch_catalog (F3): top 50 aesthetic_treatments por usage_count_30d
       ↓ fetch_profile (NEW F4): subjects.aesthetic_profile
       ↓ computedNutrition = tmb.computeAll(profile)  ← server-side, não delega ao LLM
       ↓ recommendProtocol({ metrics, subject, professionalType,
                              availableTreatments, aestheticProfile, computedNutrition })
       ↓ Sanitize: clamp calories 800-5000, macros bounds, foods strings 80 chars
       ↓ Disclaimer CRN injetado sempre (mesmo se Opus esquecer)
       ↓ Persist analysis_result com treatment_protocol + lifestyle + disclaimer
[Frontend] analysis-result → <app-treatment-protocol-cards> + lifestyle panel + disclaimer
```

## Decisões técnicas

- **TMB cálculo no backend, NÃO no LLM**: Opus 4.7 é confiável, mas aritmética crítica regulatória (calorias prescritas) não delegamos. Backend computa, prompt instrui Opus a "usar EXATAMENTE estes valores. NÃO recalcule". LLM só sugere foods, exercise minutes, hydration — qualitativos.
- **Disclaimer CRN é fail-safe**: `sanitizeLifestyle` injeta o disclaimer sempre, mesmo se Opus esquecer no output. Compliance regulatório não pode depender do LLM lembrar.
- **TMB duplicado worker/api**: sem cross-package require pra manter desacoplamento de deployment. Comentário explícito de sync nos dois arquivos.
- **Fallback gracioso**: se Opus retorna lifestyle null/garbage, recommender preenche minimamente com computedNutrition do backend + disclaimer.
- **JSONB NOT NULL DEFAULT '{}'**: zero break em human/vet, queries antigas continuam funcionando. Subjects multi-módulo preservado.

## Tests

- API: +13 (aesthetic-tmb service) +15 (aesthetic-profile routes) = 28 novos. Total 727 verdes.
- Worker: +12 (lib/tmb) +7 (recommender lifestyle) +2 (processor profile fetch) = 21 novos. Total 128 verdes.
- Web: +7 (profile form) = 7 novos. Total 132 verdes.

**~56 testes novos, 0 regressões.**

## Multi-módulo zero quebra

- `aesthetic_profile` column é `DEFAULT '{}'` — human/vet ignoram completamente. Queries `SELECT * FROM subjects` retornam mais um campo mas estável.
- Profile routes sob `/aesthetic/*` com `requireEsteticaModule` → 403 pra outros módulos.
- Aba "Perfil Estético" só visível com `module === 'estetica'`.
- Worker fetch é try/catch — se profile vazio, recommender opera em modo F3 puro (só catálogo, sem nutrição).

## Limitações honestas

- **Ranges clinicamente conservadores** (peso 35-200, altura 140-220, idade 12-100). Casos extremos (atleta de elite, criança, idoso obeso) podem precisar override manual — não implementado.
- **Mifflin-St Jeor é estimativa**: precisão clínica real exige calorimetria indireta. UI deixa claro que é estimativa.
- **CRN: orientações qualitativas apenas**: foods to_emphasize/to_minimize são sugestões gerais, não prescrição de plano alimentar. Disclaimer reforça.
- **Sem histórico de profile**: PUT sobrescreve. Audit log captura mudanças (via trigger em subjects), mas UI não mostra histórico visualmente — pode ser feature F6.

## Custos

Sem custo IA novo — TMB é local, recommender já existia. Tokens marginalmente maiores no prompt (~+500 tokens com bloco PERFIL+NUTRIÇÃO). Cost delta desprezível.

## Próxima fase

**F5 — Regiões adicionais sensíveis (10 dias).** Consent reforçado para mamilo/genital/áreas íntimas, auto-crop Sonnet Vision identifica bbox + sharp blur antes do upload, purge sensitive job. Spec §16 F5.
