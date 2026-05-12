---
name: Aesthetic Polish — 13 TODOs Pós-F6
description: Batch de polish após F6 (2026-05-11/12). 13 melhorias resolvendo todas as limitações conhecidas que ficaram documentadas durante F3-F6. ~75 testes novos, 0 regressões.
type: project
---

# Aesthetic Polish — 13 TODOs Pós-F6 (2026-05-11/12)

Após F6 completar a plataforma aesthetic, foram listados 13 TODOs documentados nas memórias F3-F6. Atacados em sequência via subagent-driven development. Todos entregues + mergeados ff-only para main.

## Lista entregue

| # | Item | Onde | Arquivos principais |
|---|------|------|---------|
| 1 | PDF UTF-8 (acentos restaurados) | api | `aesthetic-pdf-export.js` + fontkit + Roboto TTFs (~500KB cada) |
| 2 | Timeline deep-link para análise | web | `timeline-panel` emite event → `patient-detail` muda tab + passa `initialAnalysisId` → `facial-analysis-tab` jumpa pra step='result' |
| 3 | Treatment matching normalize + synonyms | worker | `normalize()` NFD, `TREATMENT_SYNONYMS` Map BR (~30 brand→generic: Botox/Dysport→Toxina Botulínica, Morpheus8→RF Microagulhada, Sculptra/Radiesse→Bioestimulador, etc.) |
| 4 | Agendar série N sessões | api+web | `POST /agenda/appointments/series` transacional (BEGIN/COMMIT, ROLLBACK em qualquer falha). count 2-20, interval_days 1-365. Dialog `quick-create` ganha toggle "Repetir N vezes" |
| 5 | Auto-crop preview pre-upload | api+web | `POST /aesthetic/photos/preview-blur` retorna buffer sem persistir. Modal `auto-crop-preview-modal` lado-a-lado original vs blurred + 3 ações |
| 6 | PDF preview em modal iframe | web | `pdf-preview-modal` standalone OnPush + DomSanitizer bypassSecurityTrustResourceUrl + botão Baixar interno (anchor click). URL.revokeObjectURL no destroy |
| 7 | Encounter auto-suggest análise recente | web | encounter-form pré-seleciona análise mais recente (≤30d + status='done') quando related_id vazio. Banner UX + alteração manual reseta flag |
| 8 | Histórico de aesthetic_profile | api+web | `GET /aesthetic/profile/:id/history` filtra audit_log por entity_type='subjects' + changed_fields @> ARRAY['aesthetic_profile']. Frontend expandable panel com diff summary |
| 9 | Purge actor_channel='system' | worker | `softDeleteAndPurge` agora em transação com `SET LOCAL app.actor_channel='system'`. Audit trail distingue worker de UI |
| 10 | Purge forceRun via endpoint | api+worker | `POST /master/aesthetic-purge-sensitive/run-now` publica em Redis canal `admin:purge-sensitive-trigger`. Worker `subscribeAdminTriggers()` dispara `runPurge({forceRun:true})` |
| 11 | TICK_UTC_HOUR configurável | worker | `AESTHETIC_PURGE_HOUR_UTC` env var (default 7 = 04h BRT). JSDoc clarifica que BRT é UTC-3 fixo desde 2019 (sem DST) |
| 12 | RETENTION_DAYS env var | worker | `AESTHETIC_SENSITIVE_RETENTION_DAYS` default 365, `AESTHETIC_PURGE_BATCH` default 100. Backward compat preservado |
| 13 | TMB allow_extreme_ranges | api | Flag opt-in expande bounds: peso 25-300, altura 100-230, idade 5-110. Warnings PT-BR quando fora da faixa adulta. **Mudança comportamental**: validate() agora REJEITA strict (não clampa silenciosamente) |

## Tests adicionados

- API: ~30 novos. Total 819 verdes (era 727 pré-polish).
- Worker: ~12 novos. Total 160 verdes.
- Web: ~30 novos. Total 192 verdes.

Suite total: **1171+ testes, 0 regressões em qualquer fase**.

## Mudanças comportamentais a saber

1. **PDF agora tem acentos corretos**. Antes "Análise" virava "Analise". Após TODO#1, sai correto. Bundle api Docker cresceu ~1MB (Roboto Regular + Bold).
2. **Treatment matching aceita brand names**. LLM retornando "Botox" agora casa com catálogo "Toxina Botulínica" via synonyms map. Sem alteração de schema — synonyms in-code.
3. **TMB validate strict**. Antes peso=30 era clampado para 35 silenciosamente. Agora retorna 400 a menos que `allow_extreme_ranges=true` (expanded to 25-300).
4. **Purge audit channel='system'** ao invés de 'ui'. Forense distingue worker job de operação humana. Pre-polish: tudo aparecia como UI.
5. **Discovery / purge env vars** override (`AESTHETIC_PURGE_HOUR_UTC`, `AESTHETIC_SENSITIVE_RETENTION_DAYS`, `AESTHETIC_PURGE_BATCH`). Defaults preservados.

## Decisões pragmáticas notáveis

- **Synonyms in-code, não em DB**: ~30 entries são suficientes para o mercado BR atual. Tabela em DB pode vir quando tenants quiserem alias próprios (não justificado agora).
- **PDF UTF-8 via Roboto TTF embarcado**: alternativa seria @fontsource/roboto, mas pdf-lib precisa de TTF direto. Adicionou 1MB ao bundle — aceitável para um endpoint dificilmente chamado.
- **Modal preview vs download direto**: usuários reportaram preferência por visualizar antes. Modal iframe é mais discoverable + permite o botão Baixar quando quiser persistir.
- **Auto-suggest com 30 dias cutoff**: balance entre "ainda relevante" vs "stale". Configurável no futuro se feedback pedir.
- **Series scheduling com count 2-20**: limita blast radius de erro humano (esteticista digitou "200" sessões). 365 dias max interval cobre planos anuais.
- **TMB strict + flag opt-in**: silent clamping mascara dados — uma pessoa pode pesar 30kg de fato (criança) e queremos saber se essa é a intenção via flag.

## Próximas evoluções deferidas (não no escopo deste polish)

- **Synonyms DB table per-tenant**: defer até alguma clínica pedir.
- **Auto-crop manual review com bbox editing**: muito UX complexo.
- **TMB para crianças/atletas via Schofield ou Cunningham**: Mifflin-St Jeor é adult-optimized. Para pediátrico devíamos usar outra fórmula. Documentado como warning, não bloqueio.
- **PDF embed de fotos da análise**: hoje só texto. Pode crescer bundle PDF significativamente.
- **Timeline aesthetic via Inter-tenant chat compartilhamento**: feature cross-tenant defer.

## Workflow

Cada TODO foi 1 commit ff-only para main com testes inline + memory update apropriada. Sem stashes, sem branches órfãs, sem --no-verify. Padrão writing-plans não foi escrito previamente (foram tasks simples, mas registrados em F6 memory). Spec de referência: `docs/superpowers/specs/2026-05-11-aesthetic-platform-design.md` §16 (próximas evoluções deferidas).
