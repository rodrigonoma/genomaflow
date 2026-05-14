# Integration Studio — Spec Completa

**Data:** 2026-04-15  
**Status:** Aprovada  
**Autor:** Sessão de brainstorm CEO/CTO + Eng Sênior IA + PO Sênior

---

## Objetivo

Eliminar o atrito de integração como bloqueador de venda. Hospitais e clínicas não vão migrar dados nem aceitar projetos de integração de meses. O Integration Studio permite que qualquer cliente conecte seu sistema legado ao GenomaFlow em até 15 minutos, sem TI especializada no processo, sem migração de dados.

**Pitch comercial:** *"Se seu sistema tem API, integração em 15 minutos. Se não tem, funciona via arquivo. De qualquer forma, você não migra nada."*

---

## Contexto de Mercado

### Sistemas prevalentes no Brasil
- **Tasy (Philips)** — líder hospitalar, REST API + HL7 v2.x
- **MV SOUL** — muito comum em médio porte, REST API
- **iClinic / Nuvem Doutor** — clínicas pequenas, REST/webhook
- **Sistemas proprietários** — frequentes em labs, geralmente HL7 v2.x ou SFTP
- **FHIR R4** — emergente, poucos sistemas suportam atualmente no BR

### Padrão de decisão do cliente
O gestor quer contratar. O TI barra com "precisamos de projeto de integração de 3 meses". O Integration Studio remove esse veto do TI tornando a integração autoservida, sem código, em minutos.

---

## Arquitetura Geral

```
┌─────────────────────────────────────────────────────────┐
│                  Integration Studio UI                   │
│  (painel admin — configuração visual, sem código)        │
└────────────────────┬────────────────────────────────────┘
                     │ configura
┌────────────────────▼────────────────────────────────────┐
│              Connector Registry (DB)                     │
│  tenant_id | mode | config_json | field_map | status     │
└────────────────────┬────────────────────────────────────┘
                     │ serve
          ┌──────────┴──────────┐──────────────────┐
          ▼                     ▼                  ▼
   ┌─────────────┐    ┌────────────────┐  ┌──────────────┐
   │ REST/Swagger │    │  HL7 v2.x      │  │  File Drop   │
   │  Connector  │    │  Listener      │  │  (SFTP/S3)   │
   └──────┬──────┘    └───────┬────────┘  └──────┬───────┘
          │                   │                  │
          └──────────┬────────┘──────────────────┘
                     ▼
          ┌──────────────────────┐
          │  Normalization Layer  │
          │  (→ GenomaFlow model) │
          └──────────┬───────────┘
                     ▼
          ┌──────────────────────┐
          │  Existing Pipeline   │
          │  (exam processing)   │
          └──────────────────────┘
```

---

## Modos de Integração

### Modo 1 — REST/Swagger Connect

**Caso de uso:** sistema legado com API REST documentada (Tasy, MV SOUL, iClinic, etc.)

**Fluxo de configuração:**
1. Admin cola a URL do Swagger/OpenAPI do sistema legado
2. Backend faz parse do schema (OpenAPI 2/3)
3. IA identifica endpoints candidatos:
   - Pacientes: busca por `patient`, `paciente`, `person` em paths/schemas
   - Exames/laudos: busca por `exam`, `laudo`, `result`, `order`
4. IA propõe mapeamento de campos (field map visual):
   - `nome` / `name` / `patient_name` → `Patient.name`
   - `cpf` / `document` → `Patient.cpf_hash` (hash automático)
   - `data_nascimento` / `birth_date` / `dob` → `Patient.birth_date`
5. Admin revisa e confirma mapeamento (UI drag-and-drop)
6. Sistema gera webhook bidirecional:
   - **Inbound:** endpoint `/integrations/{connector_id}/ingest` recebe eventos do legado
   - **Outbound:** envia resultado de análise de volta via callback configurado

**Modelo de dados do conector:**
```json
{
  "mode": "swagger",
  "swagger_url": "https://sistema.hospital.com/api/docs/swagger.json",
  "base_url": "https://sistema.hospital.com/api",
  "auth": { "type": "bearer", "token": "..." },
  "field_map": {
    "patient.name": "$.paciente.nome_completo",
    "patient.birth_date": "$.paciente.dt_nascimento",
    "patient.sex": "$.paciente.sexo",
    "exam.file_url": "$.laudo.arquivo_url",
    "exam.external_id": "$.laudo.id"
  },
  "webhook_secret": "sha256-hmac-secret"
}
```

**Sincronização:**
- Pull periódico configurável (a cada N minutos, busca exames novos)
- Push via webhook registrado no sistema legado (se suportado)
- Ambos podem coexistir

---

### Modo 2 — HL7 v2.x Listener

**Caso de uso:** laboratórios e hospitais com HIS/LIS que emite mensagens HL7

**Tipos de mensagem suportados:**
- `ORU^R01` — resultado de exame laboratorial (principal)
- `ADT^A01/A08` — admissão/atualização de paciente
- `ORM^O01` — ordem de exame

**Fluxo:**
1. Provisionamos endpoint MLLP por tenant: `mllp://integrations.genomaflow.ai:2575/{tenant_id}`
2. TI do cliente configura o sistema legado para enviar mensagens HL7 para esse endereço
3. Nós parseamos e mapeamos automaticamente para o modelo GenomaFlow
4. Respondemos com ACK (`MSH ACK`) conforme protocolo
5. Para exames com arquivo PDF (OBX com tipo `ED` ou `RP`): baixamos e processamos

**Mapeamento HL7 → GenomaFlow:**
```
MSH-4 (Sending Facility) → tenant validation
PID-5 (Patient Name)      → Patient.name
PID-7 (Date of Birth)     → Patient.birth_date
PID-8 (Sex)               → Patient.sex
PID-19 (CPF)              → Patient.cpf_hash
OBR-4 (Observation ID)    → Exam.source_type
OBX-5 (Observation Value) → Exam.file (se tipo ED/RP) ou raw_data
```

**Sem código no lado do cliente** — apenas um endereço MLLP para configurar.

---

### Modo 3 — File Drop (SFTP / S3 / local)

**Caso de uso:** sistemas que geram arquivos (PDFs, CSVs) sem API — ou para migração inicial de histórico

**Subtipos:**
- **SFTP:** credenciais SFTP → monitoramos pasta `/incoming/` a cada 60s
- **S3/Bucket:** AWS S3 ou GCS bucket com event notification → trigger automático
- **Upload manual batch:** interface admin para subir ZIP com múltiplos PDFs

**Fluxo:**
1. Admin configura credenciais no Integration Studio
2. Worker de file watch monitora a pasta/bucket
3. Ao detectar arquivo novo: cria registro de exame, enfileira processamento
4. Move arquivo para `/processed/` após sucesso, `/error/` em caso de falha
5. Opcionalmente lê CSV de metadados junto (patient name, birth_date, etc.)

**Formato CSV de metadados (opcional):**
```csv
filename,patient_name,patient_birth_date,patient_sex
laudo_001.pdf,João Silva,1980-05-15,M
laudo_002.pdf,Maria Santos,1975-11-22,F
```

---

## UI — Integration Studio (Painel Admin)

### Página: `/clinic/integrations`

**Layout:**
```
┌─ Header ──────────────────────────────────────────────┐
│  Integrações                    [+ Nova Integração]   │
│  Status geral: 1 ativo · 0 erros                      │
└───────────────────────────────────────────────────────┘

┌─ Card por conector ───────────────────────────────────┐
│  [●] Tasy — REST/Swagger           ATIVO              │
│  Último sync: há 4 min · 142 exames importados        │
│  [Editar] [Testar conexão] [Ver logs]                 │
└───────────────────────────────────────────────────────┘
```

### Wizard de configuração (3 passos):

**Passo 1 — Escolher modo:**
```
○ REST / API (Swagger)
○ HL7 v2.x  
○ File Drop (SFTP / S3)
```

**Passo 2 — Configurar conexão:**
- REST: URL do Swagger + credenciais (Bearer / Basic / API Key)
- HL7: apenas confirmar (endpoint provisionado automaticamente)
- File: credenciais SFTP ou ARN do bucket S3

**Passo 3 — Mapear campos (REST e File):**
- Exibir campos do sistema fonte (detectados automaticamente)
- Arrastar para os campos do GenomaFlow
- IA preenche sugestões automaticamente (confidence score visível)
- Botão "Testar mapeamento" com exame de amostra

**Passo 4 — Validar e ativar:**
- Executar test pull / test ingest
- Mostrar preview do exame/paciente que seria importado
- Botão "Ativar integração"

---

## API Backend — Novos Endpoints

```
POST   /integrations                    → criar conector
GET    /integrations                    → listar conectores do tenant
GET    /integrations/:id                → detalhe do conector
PUT    /integrations/:id                → atualizar configuração
DELETE /integrations/:id                → remover conector
POST   /integrations/:id/test           → testar conexão
GET    /integrations/:id/logs           → logs de sync (paginado)

POST   /integrations/:id/ingest         → webhook inbound (REST mode)
       Headers: X-GenomaFlow-Signature: sha256=...

POST   /integrations/swagger/parse      → recebe URL, retorna schema parseado
POST   /integrations/swagger/suggest    → recebe schema, retorna field map sugerido (IA)
```

---

## Banco de Dados — Novas Tabelas

```sql
CREATE TABLE integration_connectors (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('swagger', 'hl7', 'file_drop')),
  config       JSONB NOT NULL DEFAULT '{}',
  field_map    JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'inactive'
                 CHECK (status IN ('active', 'inactive', 'error')),
  last_sync_at TIMESTAMPTZ,
  sync_count   INTEGER DEFAULT 0,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integration_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connector_id   UUID NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  event_type     TEXT NOT NULL, -- 'sync', 'ingest', 'error', 'test'
  status         TEXT NOT NULL, -- 'success', 'error'
  records_in     INTEGER DEFAULT 0,
  records_out    INTEGER DEFAULT 0,
  error_detail   TEXT,
  duration_ms    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE integration_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_logs ENABLE ROW LEVEL SECURITY;
```

---

## Workers / Background Jobs

### `integration-sync` worker (BullMQ)
- Scheduled: a cada N minutos por conector ativo (configurável)
- Pull exames novos via REST/File modes
- Enfileira em `exam-processing` para cada exame novo

### `hl7-listener` service
- Servidor MLLP (TCP) rodando na porta 2575
- Multitenancy via path: `mllp://host:2575/{tenant_id}`
- Parser: `node-hl7-complete` ou implementação própria
- On receive: parse → normalize → enfileirar em `exam-processing`

### `file-watcher` worker
- Poll SFTP / S3 a cada 60s por conector File Drop ativo
- Download → save em uploads volume → enfileirar processamento

---

## Segurança

- **Webhooks inbound:** validação HMAC-SHA256 obrigatória (`X-GenomaFlow-Signature`)
- **Credenciais de terceiros:** criptografadas em repouso com AES-256 (campo `config` no DB)
- **HL7:** autenticação por IP whitelist configurável por tenant
- **File Drop:** credenciais SFTP nunca retornadas na API após salvar (write-only)
- **Logs:** dados de exame nunca logados, apenas contagens e status
- **RLS:** conectores e logs isolados por tenant_id

---

## Plano de Implementação

Ver: `docs/superpowers/plans/2026-04-15-integration-studio.md` (a ser criado)

### Fases sugeridas:

**Fase 1 (MVP para pitch):** REST/Swagger Connect + UI básica do wizard
- Permite demonstrar a feature ao vivo durante pitch comercial
- Backend: parse de Swagger + field map manual + webhook inbound
- Estimativa: 2 semanas

**Fase 2:** File Drop (SFTP + upload batch)
- Atende labs sem API
- Estimativa: 1 semana

**Fase 3:** HL7 v2.x Listener
- Atende hospitais de médio/grande porte
- Estimativa: 2 semanas

**Fase 4:** AI field mapping (sugestão automática via LLM)
- Diferencial competitivo — nenhum concorrente faz isso
- Estimativa: 1 semana

---

## Critérios de Sucesso

- Um cliente novo consegue completar a configuração em < 15 minutos sem suporte
- Taxa de erro de mapeamento < 5% após validação
- Latência de ingest (webhook → exame na fila) < 2s
- Disponibilidade do HL7 listener: 99.9%
- Objection rate de "problema de integração" cai para < 10% nos pitches
