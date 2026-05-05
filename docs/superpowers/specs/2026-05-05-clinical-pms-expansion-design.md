# GenomaFlow → PMS Clínico Completo (Caminho A) — Design Spec

**Data:** 2026-05-05
**Decisão estratégica:** elevar o GenomaFlow de "lab + IA clínica" para **PMS de clínica pequena/média com IA no centro** — sem virar ERP hospitalar e sem entrar no pântano fiscal interno (NF-e fica em integração externa, condicional).
**Origem:** análise comparativa com [simples.vet](https://simples.vet/funcionalidades/), input do usuário (planejamento de produto vinha do ChatGPT) + crítica deste documento.

## Premissas de implementação (não-negociáveis)

Reforçadas pelo usuário em 2026-05-05 — toda decisão técnica abaixo respeita estes 3 pilares:

### P1. Não quebrar funcionalidades existentes (zero regressão)

- **Schema:** todas as alterações são **aditivas** (`ALTER TABLE ADD COLUMN`, `CREATE TABLE`). Zero `DROP COLUMN`, zero `ALTER TYPE`, zero remoção de constraint que código atual dependa
- **Colunas NOT NULL adicionadas em tabela existente** (ex: `appointments.professional_user_id`) seguem padrão de 3 passos numa única migration: (1) `ADD COLUMN ... NULL`; (2) `UPDATE ... SET ...` backfill; (3) `ALTER COLUMN ... SET NOT NULL`. Se a tabela tiver volume alto, fazemos backfill em batches com `DO $$ ... LIMIT 5000 ... $$ LOOP`. Indexes criados com `CREATE INDEX CONCURRENTLY` quando possível
- **Endpoints existentes:** zero mudança de signature/contrato. Apenas novos endpoints. Se um endpoint precisar mudar shape (ex: `GET /agenda` ganhar filtro `?professional_id=`), o filtro é **opcional** — sem ele, comportamento idêntico ao atual
- **Frontend:** novas abas/componentes adicionados, **zero alteração** em telas que clínicas usam hoje. Ordem das abas existentes preservada
- **Validação obrigatória antes do merge:** smoke completo em ambos os módulos (humano + vet) cobrindo: login, dashboard, lista de pacientes, upload de exame, análise IA, prescrição, agenda single-doctor (modo legado)
- **CI gate:** os 410+ testes atuais devem continuar verdes; novos testes acompanham cada feature
- **Audit trigger** em qualquer tabela nova com PII/clinical → padrão `audit_trigger_fn()` (já existente, ver `project_audit_log.md`). Não adicionar = perda de rastreabilidade LGPD

### P2. Separação humano/veterinário sem virar emaranhado

**Princípio guia:** **infraestrutura compartilhada onde a regra é a mesma; código separado onde a regra diverge.** Sem abstrações genéricas demais que escondem o módulo (`fields[]` JSONB, polimorfismo via discriminator) — sempre que custar legibilidade.

**Estratégia adotada (3 níveis):**

| Nível | Estratégia | Exemplo |
|---|---|---|
| **Schema** | **Tabela única com colunas opcionais** (NULL pra módulo que não usa). Continuar o padrão atual do `subjects` | `clinical_encounters` tem `medical_history`/`medications_in_use` (humano) NULL pra vet; `vital_signs` tem `hydration`/`mucosa` (vet) NULL pra humano |
| **Backend** | Rota e service compartilhados; ramificação **apenas** quando regra diverge — via `if (request.user.module === 'veterinary')`. Validators recebem schema base + extension por módulo | `POST /encounters` é uma rota só. Validator tem `baseEncounterSchema` + `humanEncounterSchema` + `vetEncounterSchema` (extensões opcionais). Sem dois services duplicados |
| **Frontend** | Componente shell compartilhado (form, list, timeline). Sub-componentes específicos por módulo apenas quando UX diverge muito. Nunca duplicar componente inteiro | `EncounterFormComponent` é uma classe; renderiza `<vet-vital-signs>` ou `<human-vital-signs>` como child component conforme `tenant.module` |

**Regras explícitas:**
- **Feature 100% módulo-específica** (ex: `vaccines` na Fase 2 — só vet) → fica em diretório dedicado: `apps/api/src/routes/vet/vaccines.js`, `apps/web/src/app/features/vet/vaccines/`. Não polui o código compartilhado.
- **Feature compartilhada com divergência de campos** → tabela única + colunas opcionais. Validator/form ramifica por módulo.
- **Nunca:** `if (module) { 50 lines of vet code } else { 50 lines of human code }` no meio de uma rota compartilhada — extrai pra service helper específico.
- **Nunca:** colunas com nomes genéricos (`field1`, `extra_data`) ou JSONB schema-less pra evitar a divisão. Custa documentação e validação.
- **Test obrigatório:** todo PR que toca código compartilhado roda smoke em ambos os módulos. Multi-módulo é regra do projeto (`feedback_multi_module.md`).

### P3. Best practices, performance, custo

**Schema/DB:**
- **Toda FK tem index** explícito (Postgres não cria automaticamente)
- **Indexes compostos seguem ordem de seletividade:** `tenant_id` sempre primeiro (RLS + filtro padrão), depois `subject_id`/`professional_user_id`, depois `created_at DESC` pra timeline
- **`CREATE INDEX CONCURRENTLY`** em prod (sem lock de tabela)
- **Partial indexes** quando aplicável (`WHERE deleted_at IS NULL`)
- **Sem JSONB schema-less** em campo central — só pra `attachments` (lista pequena, semântica fixa)
- **Sem GIN index** a menos que campo seja queried (custo de manutenção alto)
- **Audit trigger** em todas as tabelas clínicas novas (já é regra do projeto)

**Backend:**
- **Pagination obrigatória** em listagens (default 50, max 200)
- **Cursor-based pagination** em timeline (não OFFSET — performance ruim em N+ páginas)
- **Sem N+1**: lista de encontros com `subject_name` faz JOIN, não N queries
- **Cache hits in Redis** quando mesma query repete (timeline raro repete → não cachear)
- **`AND tenant_id = $X` explícito em toda query** (regra invariável — `feedback_tenant_defense_in_depth.md`)
- **Validação parametrizada SEMPRE** (`$1`, `$2`) — zero string interpolation
- **Audit channel** correto em `withTenant({ channel: 'ui' | 'copilot' })`
- **Errors** com status code certo + body `{ error: 'msg' }` consistente

**Frontend:**
- **Standalone components** (já é o padrão, manter)
- **Lazy-loaded routes** pra Fase 1 (rota `/encounters/...` em chunk separado)
- **`signal()` pra estado reativo** (regra do projeto — `computed()` só reage a signals; `feedback_code_editing_rules.md`)
- **Anexos lazy-load** (não baixar todos os PDFs/imagens da timeline de uma vez)
- **Sem polling pesado** — usar WebSocket existente (`exams:done` já notifica)
- **OnPush change detection** em components novos
- **Sem libs novas** sem justificativa (Material já está; jsPDF já está; pdfjs-dist já está)

**Custo (AWS / API providers):**
- **Sem novas chamadas a Anthropic/OpenAI** na Fase 1 (encontro é texto manual do médico, sem IA)
- **Sem upload pesado** novo (anexos do encontro vão pro mesmo bucket S3 `genomaflow-uploads-prod`, prefixo `encounters/`)
- **IAM S3:** policy atual cobre `bucket/*`; OK pra prefixo novo (já consolidada)
- **Sem nova task ECS** na Fase 1 (sem job background novo)

**Observabilidade:**
- **Logs estruturados** com `request.log.info({ encounter_id, subject_id })` em ações relevantes
- **Audit log** captura toda mutação (trigger automático)
- **Test gate** novo em `apps/api/package.json#test:unit` — adicionar paths novos no script (regra do projeto — `feedback_testing_standards.md`)

## Contexto e ICP

**ICP atual reforçado:** clínica veterinária OU clínica humana **pequena/média** (1–8 profissionais), com foco em **serviço** (consulta + exame + procedimento ambulatorial). Sem internação, sem centro cirúrgico complexo, sem hospital, sem pet shop com loja de varejo, sem TISS de convênio.

**Por que esse corte:** simples.vet domina o segmento que precisa de PDV+NF-e+banho/tosa+internação (10+ anos de produto, R$ 220-359/mês). Tentar competir frontal nessa frente seria perder o diferencial real do GenomaFlow (IA clínica) por ano(s) de boilerplate ERP. O caminho é **completar o PMS o suficiente pra reter clínica pequena/média sem precisar de sistema paralelo**, e manter IA + UX moderna como vantagem competitiva.

**Vantagens já no produto que não vamos perder de vista:**
- 5 agentes IA paralelos por exame + bounding boxes em imagem
- Comparação longitudinal de marcadores
- Chatbot RAG por paciente
- Copilot por voz com tools server-side (já agenda)
- Chat entre clínicas com PII redaction automática
- Audit log forense + LGPD bem feito

## Decisões já tomadas

| # | Decisão | Trade-off aceito |
|---|---|---|
| 1 | **Caminho A:** prontuário+agenda multi → vacinas+documentos+NPS → WhatsApp+portal → integrações fiscais condicionais | Sem PDV/NF-e nativo agora; aposta no diferencial de IA |
| 2 | **NF-e/NFC-e/NFS-e:** deferida pra Fase 4+ via integração externa (Focus NFE / eNotas), nunca nativa | Cliente que precisa de fiscal hoje fica frustrado; mas %ICP que precisa é minoria (consulta puro emite via contador) |
| 3 | **PDV+Estoque+Financeiro completo:** condicionais (Fase 4+), só implementam se ≥30% de feedback dos clientes da Fase 1-3 confirmar bloqueador comercial | Risco de cliente PME pedir e a gente não ter; aceito porque se virar comum, integramos com Bling/Conta Azul |
| 4 | **Internação / centro cirúrgico:** OUT of scope permanente | Corte definitivo de mercado — clínicas com hospital usam outro sistema (simples.vet, Vetus, Vetsoft) |
| 5 | **TISS/convênio humano:** OUT da Fase 1-3, mantém só campo informativo de convênio | Clínica humana com >50% convênio fica de fora; público-alvo são particulares |
| 6 | **Banho e tosa:** entra como `appointment_type` na Fase 1 (sem módulo dedicado) | Vet com banho/tosa que precisa de pacotes/comissão por banhista fica simples; pode virar módulo na Fase 4+ se feedback pedir |
| 7 | **WhatsApp:** Fase 3, via intermediário (Z-API ou 360dialog) — não Meta Cloud API direto | +R$30-100/mês por tenant pago a intermediário, mas evita aprovação Meta + manutenção de templates oficiais |
| 8 | **Migração de simples.vet/Vetus:** Sales Ops (não dev de produto). Quando virar bloqueador comercial, fazer importer one-shot ECS task | Cliente novo que quer migrar dados ainda precisa de "manual" no curto prazo |
| 9 | **Multi-tenant + RLS+FORCE:** mantido em todas as tabelas novas; defesa em profundidade (`AND tenant_id = $X` explícito) é regra invariável | Sem tenant_id explícito = bug crítico (regra do projeto) |
| 10 | **Compatibilidade com dados existentes:** zero regressão. `subjects`, `owners`, `appointments`, `prescriptions` são extendidos, não substituídos | Migrations são ALTER ADD COLUMN, não DROP/RECREATE |

## Arquitetura incremental — visão geral

```
Hoje:                                    Fase 1 (próxima):
┌───────────────────┐                    ┌───────────────────────────┐
│ Subjects (h+v)    │                    │ Subjects (campos extra)   │
│ Owners (vet)      │                    │ Owners (observações)      │
│ Exams + IA        │                    │ Exams + IA  (sem mudança) │
│ Prescriptions     │                    │ Prescriptions (=)          │
│ Appointments V1   │ ─── extends ─────▶ │ + clinical_encounters     │
│ (single-doctor)   │                    │ + appointments multi-prof │
└───────────────────┘                    │ + vital_signs (por enc)   │
                                         └───────────────────────────┘
                                                    │
                                                    ▼
Fase 2:                                  Fase 3:
┌─────────────────────┐                  ┌─────────────────────┐
│ + vaccines          │                  │ + WhatsApp messaging│
│ + vaccine_protocols │                  │ + scheduled_notif   │
│ + clinical_documents│                  │ + portal_tokens     │
│ + nps_surveys       │                  │ + portal endpoints  │
└─────────────────────┘                  └─────────────────────┘
```

Cada fase é uma branch separada, mergeada após smoke local + aprovação. Schema é aditivo (ALTER ADD COLUMN, novas tabelas, nada de DROP).

## Fases — overview de escopo

### Fase 1 — Prontuário clínico + Agenda multi-profissional + Cadastro expandido (~4-6 semanas)

**Por que primeiro:** prontuário é a maior lacuna real do GenomaFlow vs PMS de mercado. Sem isso a clínica usa sistema paralelo só pra "anotar a consulta", e quando usa paralelo, não larga.

**Entrega:**
- Migration `065_clinical_encounters.sql` — `clinical_encounters` (consulta/evolução), `vital_signs` (sinais vitais por encontro)
- Migration `066_subjects_clinical_extended.sql` — `subjects` ganha campos vet (microchip, alergias_text, peso_atual_kg, castrado, espécie aprimorada, raça texto livre) e human (data_nascimento, sexo, contato_emergencia_nome+fone, convenio_nome opcional)
- Migration `067_owners_observations.sql` — `owners.observations` TEXT
- Migration `068_appointments_multi_professional.sql` — `appointments` ganha `professional_user_id` (NOT NULL com default = user_id atual), `appointment_type` enum extendido, índice (tenant_id, professional_user_id, start)
- Backend novo: `/encounters` (CRUD + listagem por subject); `/agenda` evolui (filtro `?professional_id=`)
- Frontend: aba "Prontuário" no patient-detail com **timeline unificada** (encontros + exames + análises IA + prescrições, ordenados por data); seletor de profissional na agenda
- Tests: ACL, RLS, schema validation, multi-módulo (humano vs vet)

### Fase 2 — Vacinas (vet) + Documentos clínicos (human) + NPS (cross) (~3-4 semanas)

- Migration `069_vaccines.sql` — `vaccines`, `vaccine_protocols` (espécie+default), trigger audit
- Migration `070_clinical_documents.sql` — `clinical_documents` (atestado, pedido_exame, encaminhamento, relatorio) + `clinical_document_templates` por tenant
- Migration `071_nps_surveys.sql` — `nps_surveys` enviado pós-encontro
- Backend: `/vaccines` CRUD + `/vaccines/upcoming` + `/vaccines/overdue`; `/clinical-documents` CRUD + PDF (jsPDF reusa padrão das prescrições); `/nps/send` + `/nps/respond/:token` (público com token)
- Frontend: aba "Vacinas" no patient-detail (vet only, gated por `tenant.module`); botões "Gerar atestado / pedido de exame / encaminhamento" no encounter; widget NPS pós-consulta no portal (Fase 3) ou email (já tem SES)
- Tests: regra de "vacina vencida" (CURRENT_DATE > next_dose_date), template PDF, multi-módulo

### Fase 3 — WhatsApp + Lembretes automáticos + Portal do tutor/paciente (~5-7 semanas)

- Decisão técnica prévia: **Z-API** (mais barato, R$ 60/mês/conta sem volume base) **vs 360dialog** (R$ 100+/mês, oficial Meta) — recomendo começar Z-API e migrar pra 360dialog se virar volume relevante
- Migration `072_notifications.sql` — `notification_preferences` por tenant + `scheduled_notifications` (BullMQ-backed)
- Migration `073_portal.sql` — `portal_tokens` (subject_id, owner_id, token, expires_at, scope)
- Backend: scheduler de lembretes (BullMQ cron job a cada 30min checando agendamentos T-24h e T-2h, vacinas vencidas, retornos pendentes); webhook receiver de WhatsApp; endpoints públicos `/portal/:token/...` (read-only: agenda futura, exames disponíveis, prescrições, atestados)
- Frontend: portal mobile-first (lazy bundle separado, sem Material pesado, foca performance); settings de notificação na clínica (toggle por canal: email/WhatsApp); inbox de WhatsApp na própria UI (best-effort — sem virar CRM completo)
- Tests: WhatsApp send (mocked), portal token expiry, ACL portal (não permite ver outro paciente)

### Fase 4 — Decisão condicional (~variável)

Avaliar com base em feedback dos clientes da Fase 1-3:

- **Se ≥30% pedem PDV interno** → integração com Focus NFE / eNotas (2-3 semanas) + tela de venda + recebíveis simples
- **Se preferem fluxo externo** → conector pra Bling/Conta Azul (Bling tem API Open) ou simplesmente seguir terceirizando contador
- **Banho/tosa pacotes + comissão por banhista** → módulo dedicado se ICP vet pedir
- **Telemedicina/teleconsulta** → integração com Daily.co ou Whereby
- **Painel de espera** (chamada de paciente na recepção) → componente standalone tipo TV-room

### Fase 5+ — Backlog longo (ver tabela "Features deferidas" abaixo)

## Features DEFERIDAS — backlog mapeado

Tudo que apareceu na análise mas **não entra agora** (e em qual fase potencialmente entra):

### Mapa fiscal (Fase 4+ condicional)
- **NF-e modelo 55** (venda de produto entre empresas) — Fase 4+ via Focus NFE
- **NFC-e modelo 65** (venda varejo ao consumidor) — Fase 4+ via Focus NFE; relevante só pra clínica que vende produto na recepção
- **NFS-e** (nota de serviço, municipal) — Fase 4+ via Focus NFE/eNotas; complexidade varia por município
- **Conciliação de cartões com extrato adquirente** (Stone, Cielo, Rede) — Fase 5+; exige integração com cada adquirente
- **Faturamento TISS XML pra convênios humanos** — OUT permanente (não é ICP)

### PDV / Estoque / Financeiro (Fase 4+ condicional)
- **PDV completo** com kits/pacotes, devoluções, comissão por vendedor — Fase 4+ se feedback validar
- **Estoque** com SKU, lote, validade, fornecedor, pedido de compra, XML, etiquetas, fracionamento — Fase 4+ acoplado ao PDV
- **Fluxo de caixa diário, contas a pagar, contas a receber** — Fase 4+ se PDV nativo vier
- **Demonstrativo financeiro mensal, vendas por forma de pagamento, ranking de consumidores** — Fase 4+ acoplado ao PDV
- **Integração com adquirentes (Stone)** — Fase 5+
- **Crédito de cliente, devolução de venda, controle de débito** — Fase 4+ se PDV vier

### Internação / Hospital (OUT permanente)
- Histórico de internação, controle de boxes, parâmetros clínicos contínuos, prescrições de internação, triagem
- **Justificativa:** corte de ICP definitivo. Clínicas com hospital usam simples.vet, Vetus, Vetsoft — competitivo desigual.

### Banho e tosa dedicado (Fase 4+ condicional)
- Agenda dedicada por banhista/tosador com pacotes
- Comissão por banhista, controle de consumo interno
- Pacotes recorrentes (cliente compra 10 banhos)
- **Justificativa:** Fase 1 atende como "tipo de agendamento". Se vet com banho/tosa virar parte do ICP, vira módulo.

### Comunicação avançada (Fase 5+)
- **Lembretes via SMS** (R$ 0,25/msg em simples.vet) — Fase 5+ (WhatsApp tem maior penetração)
- **Mensagens de aniversário automáticas** — Fase 3 ou 5+, baixo esforço
- **Pesquisa NPS dashboard** com agregação por profissional/período — Fase 4+
- **Campanhas de marketing via SMS** — Fase 5+ ou nunca (não é core)
- **Site grátis** (simples.vet oferece site institucional pro cliente) — OUT, não é função de PMS
- **Ranking dos melhores consumidores** — Fase 4+ acoplado ao financeiro

### Telemedicina / Teleconsulta (Fase 4+)
- Integração com Daily.co / Whereby / Twilio Video
- Sala única por consulta agendada
- Gravação opcional (com consentimento explícito do paciente)

### Mobile / Apps nativos (Fase 5+)
- App nativo iOS/Android pro tutor/paciente — defer; portal web mobile-first cobre 80%
- App pro profissional pra anotar consulta no celular — defer; PWA do GenomaFlow já cobre

### Outros simples.vet que **não vêm**
- Inventário de estoque pelo celular (Fase 4+)
- Impressão de etiquetas (Fase 4+ se PDV)
- Análise automática de estoque, sugestões de compra (Fase 4+)
- Devolução ao fornecedor com NF (Fase 4+)
- Controle de avarias / perda de validade (Fase 4+)
- Análise de desempenho de vendedor / produtos recomendados (Fase 4+)
- WhatsApp Web embutido (UI dentro do sistema) — Fase 5+; Fase 3 entrega só envio outbound
- Mensagens automáticas customizáveis com %placeholders% — Fase 3 entrega templates simples; customização rica fica Fase 5+
- Migração automática de 30+ sistemas legados — **Sales Ops**, importer ECS task one-shot quando virar bloqueador comercial

### Adicionais que GenomaFlow precisa pensar (não simples.vet)
- **Export LGPD self-service** — direito de portabilidade do tenant; deve ser feature, mesmo que defer pra Fase 5+
- **Painel de espera/chamada de paciente** (recepção da clínica humana) — Fase 4+ se houver demanda
- **Termos/autorização de procedimento assinados** (ex: anestesia, eutanásia) — Fase 2 ou 3 (extensão dos clinical_documents)
- **Receituário digital com QR code de validação** (CFM 2.299/2021 já permite assinatura ICP-Brasil-A1) — Fase 3+; integração com Vault de certificado
- **Relatórios médicos de gestão** (não financeiros): retornos pendentes, vacinas vencidas no portfólio, evolução epidemiológica do consultório — Fase 4+ via dashboard

## Modelos de dados — visão de alto nível

### Entidades novas (Fase 1)

**`clinical_encounters`** — uma consulta/evolução clínica
```
id UUID PK
tenant_id UUID FK (RLS+FORCE)
subject_id UUID FK -> subjects
professional_user_id UUID FK -> users
appointment_id UUID FK -> appointments NULL  -- vincula ao slot agendado se houver
encounter_type TEXT  -- consulta | retorno | evolucao | procedimento | telemedicina
chief_complaint TEXT  -- queixa principal
anamnesis TEXT  -- história clínica (vet) ou HDA (human)
medical_history TEXT NULL  -- antecedentes (human only)
medications_in_use TEXT NULL  -- medicamentos (human only)
allergies TEXT NULL  -- alergias
physical_exam TEXT  -- exame físico
hypothesis TEXT  -- hipótese/suspeita diagnóstica
conduct TEXT  -- conduta
return_recommendation TEXT NULL  -- "retornar em 7 dias", etc.
attachments JSONB DEFAULT '[]'  -- [{filename, s3_key, mime}]
created_at, updated_at TIMESTAMPTZ
```

**`vital_signs`** — sinais vitais por encontro (1:1 com encounter, separado pra normalizar e facilitar timeline gráfica futura)
```
id UUID PK
tenant_id UUID FK
encounter_id UUID FK -> clinical_encounters UNIQUE
weight_kg NUMERIC(6,2) NULL  -- peso (vet usa muito; human também)
temperature_c NUMERIC(4,1) NULL
heart_rate_bpm INTEGER NULL
respiratory_rate_rpm INTEGER NULL
blood_pressure_systolic INTEGER NULL  -- humano principalmente
blood_pressure_diastolic INTEGER NULL
hydration TEXT NULL  -- normal | leve | moderada | severa (vet)
mucosa TEXT NULL  -- normocoradas | hipocoradas | cianoticas | ictéricas (vet)
pain_score SMALLINT NULL  -- 0-10
notes TEXT NULL
created_at TIMESTAMPTZ
```

### Extensões em entidades existentes (Fase 1)

**`subjects` — adiciona:**
```
microchip TEXT NULL  -- vet only
allergies_text TEXT NULL  -- texto livre (separado de medical_history humano)
current_weight_kg NUMERIC(6,2) NULL  -- snapshot do último peso
neutered BOOLEAN NULL  -- vet only
birth_date DATE NULL  -- human; vet já tem birth_date_or_age textual hoje
sex TEXT NULL  -- human only (M | F | other)
emergency_contact_name TEXT NULL  -- human only
emergency_contact_phone TEXT NULL  -- human only
insurance_name TEXT NULL  -- human only — convênio nome textual, sem TISS
```

**`owners` — adiciona:**
```
observations TEXT NULL
```

**`appointments` — adiciona (migration segura em 3 passos atômica):**
```sql
-- Migration 068: appointments multi-professional (zero downtime)
-- Passo 1: ADD nullable
ALTER TABLE appointments ADD COLUMN professional_user_id UUID REFERENCES users(id);
-- Passo 2: backfill com criador (user_id já é o owner do appointment hoje)
UPDATE appointments SET professional_user_id = user_id WHERE professional_user_id IS NULL;
-- Passo 3: NOT NULL constraint após backfill
ALTER TABLE appointments ALTER COLUMN professional_user_id SET NOT NULL;
-- Index pra agenda multi-prof
CREATE INDEX CONCURRENTLY idx_appointments_tenant_prof_start
  ON appointments(tenant_id, professional_user_id, start_at);
-- Extender CHECK do appointment_type
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_appointment_type_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_appointment_type_check
  CHECK (appointment_type IN
    ('consulta','retorno','vacina','procedimento','banho_tosa','telemedicina','exame','outro','blocked'));
```

**Compatibilidade:** rotas existentes que fazem `INSERT INTO appointments` continuam funcionando — nas inserts atuais o `user_id` é o profissional implicitamente. Adicionamos no INSERT também `professional_user_id = user_id` explícito (PR mesma migration). Backfill cuida do passado.

### Entidades Fase 2-3 (resumo, detalhe vai em spec dedicada)

- `vaccines` (vet) + `vaccine_protocols`
- `clinical_documents` (atestado, pedido_exame, encaminhamento, relatorio) + `clinical_document_templates`
- `nps_surveys`
- `notification_preferences` + `scheduled_notifications`
- `portal_tokens`

## Endpoints backend — overview

### Fase 1 (novos)

| Método + Path | Auth | Pagination | Notas |
|---|---|---|---|
| `POST /encounters` | authenticate | — | Validação shared + extension por módulo. Body inclui `subject_id`, `appointment_id?`, campos clínicos. `tenant_id` + `professional_user_id` do JWT (nunca do body) |
| `GET /encounters?subject_id=&cursor=&limit=` | authenticate | **Cursor (created_at + id)** | Default limit 50, max 200. Sem OFFSET pra escala |
| `GET /encounters/:id` | authenticate | — | RLS + `AND tenant_id = $X` explícito |
| `PATCH /encounters/:id` | authenticate | — | 409 se >24h da criação OU se já assinado. Cria audit row com diff |
| `POST /encounters/:id/sign` | authenticate | — | Marca `signed_at = NOW()`, `signed_by_user_id = req.user.id`. Imutável depois |
| `GET /subjects/:id/timeline?cursor=&limit=` | authenticate | **Cursor + UNION ALL** | Encontros + exames + prescrições + análises IA — query única com UNION ALL e ORDER BY created_at DESC. Default limit 50 |
| `GET /agenda?professional_id=&from=&to=` | authenticate | Limit 200, time-window | `professional_id` opcional (sem ele = todos do tenant para admin, ou só self pra profissional). `from/to` obrigatórios, max 90 dias |
| `GET /agenda/professionals` | authenticate | — | Lista users do tenant com `crm_number` + `crm_uf` + `professional_data_confirmed_at`. Cacheável (raro muda) |

**Pattern de cursor pagination:**
```sql
-- WHERE tenant_id = $1 AND subject_id = $2
-- AND (created_at, id) < ($cursor_created_at, $cursor_id)
-- ORDER BY created_at DESC, id DESC LIMIT 50
```
Cursor é base64 de `{created_at, id}` na response. Frontend manda no próximo request.

### Fase 2 (novos)
- `/vaccines` CRUD + `/vaccines/upcoming?days=30` + `/vaccines/overdue`
- `/clinical-documents` CRUD + `POST /clinical-documents/:id/pdf`
- `/nps/send`, `/nps/:token` (público, score), `/nps/responses?period=`

### Fase 3 (novos)
- `/notifications/preferences` (tenant settings)
- `/portal/:token/profile`, `/portal/:token/agenda`, `/portal/:token/exams`, `/portal/:token/prescriptions`
- `/whatsapp/send` interno (pra Copilot ou jobs)
- Webhook `/whatsapp/inbound`

## Componentes frontend Angular

### Fase 1 (novos)

**Compartilhados** (em `apps/web/src/app/features/encounters/`):
- `EncounterFormComponent` — shell do formulário de evolução. Renderiza seções universais (queixa, anamnese, exame físico, conduta, retorno) e delega seções módulo-específicas via child components
- `EncounterListComponent` — lista de encontros do paciente (aba "Prontuário")
- `TimelineComponent` — timeline unificada com filtros por tipo (encontro/exame/prescrição/análise IA). Cursor-pagination pra performance
- `EncounterAttachmentsComponent` — sub-componente compartilhado pra upload de anexos

**Específicos por módulo** (mantém código separado quando UX diverge):
- `apps/web/src/app/features/encounters/vet/VetVitalSignsComponent` — sinais vitais com hidratação/mucosa/peso
- `apps/web/src/app/features/encounters/human/HumanVitalSignsComponent` — sinais vitais com PA/peso, sem hidratação/mucosa
- `apps/web/src/app/features/encounters/human/HumanHistoryFieldsComponent` — antecedentes + medicamentos em uso (humano only, não polui form vet)

**Agenda (extende existente, não recria):**
- `AgendaProfessionalSelectComponent` — seletor de profissional (admin vê todos, profissional vê só seu)
- `AgendaComponent` (existente) — recebe `selectedProfessional` como input opcional; sem ele, comportamento idêntico ao atual (single-doctor mode preservado)

### Padrão de ramificação por módulo (no template)

```html
<!-- EncounterFormComponent template -->
<form>
  <!-- Universal -->
  <queixa-input [(ngModel)]="encounter.chiefComplaint"></queixa-input>
  <anamnesis-input [(ngModel)]="encounter.anamnesis"></anamnesis-input>

  <!-- Módulo-específico via if explícito (não @switch escondido) -->
  @if (module === 'human') {
    <human-history-fields [(history)]="encounter.medicalHistory"></human-history-fields>
  }

  <physical-exam-input [(ngModel)]="encounter.physicalExam"></physical-exam-input>

  @if (module === 'veterinary') {
    <vet-vital-signs [(signs)]="vitalSigns"></vet-vital-signs>
  } @else {
    <human-vital-signs [(signs)]="vitalSigns"></human-vital-signs>
  }

  <!-- Universal -->
  <conduct-input [(ngModel)]="encounter.conduct"></conduct-input>
</form>
```

Sem `@switch` aninhado em 5 níveis, sem if dentro de if, sem campo "magic" que muda significado por módulo. Legibilidade prioridade.

### Reutilizações
- `prescription-modal.component` — padrão pra extender em `clinical-document-modal` na Fase 2
- Patient detail tabs já existem (Perfil/Exames/Análises/Evolução/Tratamentos) — adiciona "Prontuário" como **nova tab** (sem mexer nas existentes)
- Patient list, agenda existentes — extends, não recria

## Permissões / RLS

**Roles existentes:**
- `admin` (admin da clínica) — vê tudo do seu tenant
- `master` — superusuário, vê tudo de todos os tenants

**Novo conceito:** "profissional ativo" = `users` da clínica que tem `crm_number` + `crm_uf` + `professional_data_confirmed_at`. Esses usuários aparecem no seletor de profissional da agenda.

**Regras de visibilidade no prontuário:**
- Admin vê todos os encontros do tenant
- Profissional vê todos os encontros do tenant (intencional — clínica colaborativa por default; pode virar configuração)
- Master vê tudo (auditoria)

**RLS em todas as tabelas novas:**
- `clinical_encounters`, `vital_signs`, `vaccines`, `clinical_documents`, `nps_surveys`, `notification_preferences`, `scheduled_notifications` — ENABLE+FORCE com NULLIF pattern (tenant scoped + master bypass)
- `vaccine_protocols` — global ou tenant (a decidir; protocolos default vão como global, customizações por tenant)
- `portal_tokens` — RLS por subject_id → tenant (defesa em profundidade)

## Plano de testes (overview)

### Cobertura mínima Fase 1

**Unit (sem DB, CI gate — `apps/api/npm run test:unit`):**
- Validation schemas dos novos endpoints (Fastify isolado pattern, modelo `tests/routes/billing-validation.test.js`)
- ACL: profissional não pode editar encontro de outro profissional após 24h
- ACL: profissional só vê agenda dele por default; admin vê todos; cross-tenant bloqueado (regression guard pro padrão `master !== admin`)
- Multi-módulo:
  - Body com `medical_history` num tenant `module='veterinary'` deve retornar 400 ou ignorar silenciosamente (decidir comportamento, validar em test)
  - Body com `hydration` num tenant `module='human'` mesma regra
- Cursor pagination: `cursor` inválido retorna 400 (não 500)
- `appointment_type` extendido aceita os 9 valores; outros = 400

**Integration (DB-dep, fora do CI gate — `apps/api/npm test`):**
- Timeline retorna eventos em ordem correta entre tipos diferentes (encontro + exame + prescrição misturados)
- Update após 24h falha com 409
- Update após `signed_at` falha com 409
- Backfill da migration `appointments.professional_user_id` preenche corretamente (count antes/depois deve bater)
- Audit log captura INSERT/UPDATE/DELETE em `clinical_encounters` com `actor_channel='ui'`

**Smoke E2E (manual antes do merge):**
- Login admin humano → cria encontro → upload anexo → vê na timeline
- Login admin vet → cria encontro com peso/temp/hidratação → vê na timeline
- Login admin → agenda mostra todos profissionais; switch pro user profissional → agenda só dele
- Vet abre paciente humano (não deveria existir, mas testar — multi-módulo isolado)
- Verificar: clínicas existentes (com appointments single-doctor) continuam funcionando após backfill — aba Agenda renderiza idêntica ao atual

**Frontend (Jest + jsdom):**
- `EncounterFormComponent` validation
- `TimelineComponent` ordering + cursor handling
- Module-specific child components (`VetVitalSigns` vs `HumanVitalSigns`) não renderizam fora do módulo correto

**Regressão dos testes existentes (CI gate):**
- 410+ testes atuais devem continuar verdes
- Smoke específico: rotas `/agenda/*` e `/exams/*` (mais sensíveis a mudança em `appointments`)

### Critérios de aceite Fase 1
- ✅ Cadastros existentes mantêm compatibilidade (zero regressão de dados — só ALTER ADD COLUMN)
- ✅ Tutor/animal e paciente humano exibem campos expandidos quando preenchidos
- ✅ Existe registro de evolução clínica funcional no prontuário
- ✅ Timeline do paciente/animal mostra evoluções, exames e prescrições ordenados
- ✅ Agenda permite filtro por profissional da clínica
- ✅ Nenhuma rota permite acessar dados de outro tenant (testes provam)
- ✅ CI gate (`npm run test:unit`) passa
- ✅ Smoke local OK em ambos os módulos antes de merge

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Backfill de `appointments.professional_user_id` corrompe agenda existente | Migration faz `professional_user_id = user_id` (criador do agendamento). Validar com count antes/depois |
| Schema explodir em colunas opcionais nullable em `subjects` | Aceito — alternativa seria tabelas separadas `subjects_human_extra` e `subjects_vet_extra` que complica joins. Trade-off explícito. |
| Cliente espera prontuário com assinatura digital ICP-Brasil em Fase 1 | Out of scope; defer pra Fase 3 (clinical_documents) ou Fase 4+. Comunicar |
| Multi-profissional muda permissionamento de exames/prescrições existentes | NÃO. Fase 1 é só agenda + encontros novos. Exames/prescrições continuam tenant-scoped sem mudança |
| Timeline performance ruim com paciente de 5+ anos | Pagination + lazy load de attachments. Index `(tenant_id, subject_id, created_at DESC)` |
| Edição de encontro após 24h vira política controversa | Configurável por tenant em fase futura; default 24h alinha com prática médica de adendo |
| Migration roda em prod com 1000+ tenants e demora | ALTER ADD COLUMN com DEFAULT NULL é instantâneo no Postgres 11+. Backfill de `professional_user_id` em batch se necessário |

## Open questions (preciso de decisão antes da Fase 1)

1. **Política de edição de encontro:** 24h é OK como default? Profissional pode editar próprio encontro nas primeiras 24h, depois força "adendo" (novo encontro vinculado). Após assinado (`POST /encounters/:id/sign`), imutável.
2. **Profissional vê encontros de outros profissionais do mesmo tenant?** Recomendo SIM por default (clínica colaborativa), pode virar configuração depois.
3. **`professional_user_id` no `appointments`:** backfill com `user_id` (criador) é OK? Ou prefere null + warning na UI até admin atribuir?
4. **Aba "Prontuário" no patient-detail** vai ser nova ou substitui aba "Análises IA" / "Tratamentos"? Recomendo NOVA aba, sem mexer nas existentes.
5. **Vacinas em humano:** entra na Fase 2 (vacina pediátrica, COVID, etc) ou só no vet? Recomendo só vet na Fase 2; humano fica deferido pra Fase 4+ se ICP pedir.

## Próximos passos

1. Você aprova essa spec (com os ajustes que quiser)
2. Escrevo `docs/superpowers/plans/2026-05-05-phase-1-prontuario-agenda.md` com plano detalhado de implementação task-by-task
3. Você aprova o plano
4. Crio branch `feat/clinical-encounters-and-multi-prof-agenda` (ou nome que preferir) e implemento
5. Smoke local em humano + vet, apresento resultado, pede merge

**Não faço nada de código antes do OK na spec + no plano.**
