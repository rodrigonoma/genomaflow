# Receita Médica/Veterinária — Design Spec
**Data:** 2026-04-21  
**Escopo:** Feature completa de prescrição gerada por IA, revisada pelo profissional, com geração de PDF, envio e armazenamento.

---

## 1. Banco de Dados

### Nova tabela `prescriptions`
```sql
CREATE TABLE prescriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  subject_id  UUID NOT NULL REFERENCES subjects(id),
  exam_id     UUID NOT NULL REFERENCES exams(id),
  created_by  UUID NOT NULL REFERENCES users(id),
  agent_type  TEXT NOT NULL CHECK (agent_type IN ('therapeutic', 'nutrition')),
  items       JSONB NOT NULL DEFAULT '[]',
  notes       TEXT,
  pdf_url     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY prescriptions_tenant ON prescriptions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

### Alterações em `tenants`
```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS clinic_logo_url TEXT;
```

### Estrutura do campo `items` (JSONB)
```json
[
  {
    "name": "Metformina",
    "dose": "500mg",
    "frequency": "2x ao dia com refeições",
    "duration": "30 dias — reavaliar",
    "notes": "Ajustar conforme função renal"
  }
]
```
Para receitas de nutrição, `dose` e `duration` podem ser `null`.

---

## 2. Agentes (Worker)

### Agente Terapêutico
- Alterar prompt para sugerir medicamentos específicos com dose, frequência e duração recomendada
- Disclaimer explícito: sugestão de suporte à decisão — profissional valida antes de prescrever
- Novo formato de `recommendations` para type `medication`:
```json
{
  "type": "medication",
  "name": "Metformina",
  "dose": "500mg",
  "frequency": "2x ao dia com refeições",
  "duration": "30 dias — reavaliar",
  "priority": "high",
  "description": "Para controle glicêmico — ajustar conforme função renal"
}
```
- `type: procedure` e `type: referral` mantêm o formato atual (sem `name`/`dose`/`frequency`/`duration`)
- Compatibilidade: prompt adapta farmacologia por `module` (human vs veterinary) e `species`

### Agente de Nutrição
- Ajustar prompt para vincular cada recomendação aos marcadores problemáticos encontrados
- Exemplo: "Reduzir carboidratos simples — glicemia 187 mg/dL detectada"
- Formato JSON mantido: `type: diet|habit|supplement|activity`
- Itens de `supplement` devem incluir nome e dose sugerida quando aplicável

---

## 3. API (Backend)

### Endpoints — Receitas
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/prescriptions` | Cria receita com items editados |
| `GET` | `/exams/:examId/prescriptions` | Lista receitas do exame |
| `GET` | `/prescriptions/:id` | Detalhe de uma receita |
| `PUT` | `/prescriptions/:id` | Atualiza receita |
| `DELETE` | `/prescriptions/:id` | Remove receita |
| `POST` | `/prescriptions/:id/send-email` | Infra pronta — retorna `501` até provider configurado |

**Body de `POST /prescriptions`:**
```json
{
  "subject_id": "uuid",
  "exam_id": "uuid",
  "agent_type": "therapeutic",
  "items": [...],
  "notes": "observações livres"
}
```

**PDF:** gerado no browser (jsPDF). `pdf_url` é atualizado via `PUT /prescriptions/:id` após upload do PDF ao S3.

Todos os endpoints: `preHandler: [fastify.authenticate]`. RLS garante isolamento por tenant.

### Endpoints — Perfil da Clínica
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/clinic/profile` | Retorna nome, CNPJ, logo_url, module |
| `PUT` | `/clinic/profile` | Atualiza nome e CNPJ |
| `POST` | `/clinic/logo` | Upload do logo → S3 → salva URL no tenant |

---

## 4. Frontend (Angular)

### Modal "Editar Perfil" (avatar top-right)
- Acessível via menu no avatar do usuário (top-right do app.component)
- Campos: Nome da Clínica, CNPJ, Especialidade, Logo (upload com preview)
- Logo enviada via `POST /clinic/logo` (multipart/form-data)
- Disponível para roles `admin` e `master`
- Implementado como componente standalone `ClinicProfileModalComponent`

### Botão "Gerar Receita" (result card)
- Exibido no card de resultado do agente `therapeutic` e `nutrition`
- Presente tanto no `result-panel.component` quanto no `patient-detail.component`
- Ao clicar: abre `PrescriptionModalComponent`

### `PrescriptionModalComponent`
- Pré-populado com items do agente (apenas `type: medication` para therapeutic; todos para nutrition)
- Por item: inputs para nome, dose, frequência, duração, observações; botão de deletar
- Botão "Adicionar item" para inclusão manual
- Campo de observações gerais
- Botão "Salvar e Gerar PDF": salva no backend, gera PDF, exibe ações

### Geração de PDF (jsPDF — browser-side)
Estrutura do PDF:
1. **Cabeçalho:** logo da clínica (esquerda) + nome, CNPJ, data (direita)
2. **Identificação:** nome do paciente/animal, espécie (se veterinário), data
3. **Corpo:** lista numerada de medicamentos/cuidados com dose, frequência, duração
4. **Observações:** campo de notas gerais
5. **Rodapé:** disclaimer legal + área de assinatura do profissional
6. **Marca d'água sutil:** "GenomaFlow Clinical AI"

Após gerar o PDF:
- Upload do blob para S3 via `POST /exams/:examId/prescriptions/:id/pdf` (ou direto via signed URL)
- `pdf_url` atualizado na receita

### Ações pós-PDF
- **Imprimir:** `window.print()` ou download como `.pdf`
- **WhatsApp:** `window.open('https://wa.me/?text=Receita ${nome} - ${data}: ${pdf_url}')` — abre app do WhatsApp com link do PDF
- **Email:** botão presente, exibe snackbar "Envio por email será ativado em breve" — endpoint já existe no backend

### Exibição no result card
- Seção colapsável "Receitas geradas" abaixo das recomendações do agente
- Lista: data, profissional que gerou, botão "Ver / Reimprimir"
- Carregada via `GET /exams/:examId/prescriptions` filtrado por `agent_type`

---

## 5. Compatibilidade Multi-módulo

| Aspecto | `human` | `veterinary` |
|---------|---------|--------------|
| Prompt terapêutico | Farmacologia humana, ANVISA | Farmacologia veterinária, espécie-específica |
| Prompt nutrição | Diretrizes brasileiras de nutrição humana | Manejo alimentar por espécie/raça |
| PDF — identificação | "Paciente: [nome]" | "Animal: [nome] — Espécie: [espécie]" |
| PDF — assinatura | CRM | CRMV |
| Disclaimer | Prescrição médica | Prescrição veterinária |

---

## 6. Segurança e Integridade

- Todos os endpoints de receita usam `withTenant` para escritas
- RLS FORCE em `prescriptions` — tenant nunca acessa receitas de outro tenant
- Logo da clínica: upload restrito a `role: admin` — validação de tipo de arquivo (image/png, image/jpeg) e tamanho máximo (2MB)
- PDF gerado no browser — nenhum dado sensível trafega desnecessariamente para o servidor
- `POST /prescriptions/:id/send-email` retorna `501 Not Implemented` com body `{ error: 'Envio por email será ativado em breve. Configure o provider em /clinic/settings.' }` até provider ser configurado

---

## 7. Funcionalidades Existentes — Garantias de Não-Regressão

- Agentes terapêutico e nutrição: formato de `recommendations` é retrocompatível — novos campos (`name`, `dose`, `frequency`, `duration`) são opcionais; componentes que renderizam `description` continuam funcionando
- `result-panel.component`: botão "Gerar Receita" é adicionado sem alterar a renderização existente das recomendações
- `patient-detail.component`: seção "Receitas geradas" é adicionada ao card do agente sem afetar as seções existentes
- Nenhuma migration altera tabelas existentes de forma destrutiva — apenas `ADD COLUMN IF NOT EXISTS`
- `prescriptions` é nova tabela — zero impacto em queries existentes

---

## 8. Ordem de Implementação

1. Migration SQL (039)
2. Agentes worker (therapeutic + nutrition prompts)
3. Endpoints API (prescriptions + clinic profile)
4. `ClinicProfileModalComponent` + avatar menu
5. `PrescriptionModalComponent` com jsPDF
6. Exibição de receitas salvas no result card
7. Smoke test: criar receita → PDF → WhatsApp link → consultar no patient-detail
