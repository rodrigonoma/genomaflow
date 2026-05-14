# Portabilidade de Paciente Entre Clínicas (Cross-Tenant)

> **Status**: 📌 Discutida em 2026-05-09 mas NÃO iniciada — feature futura para retomar quando priorizada.

## Cenário

Paciente passou pela Clínica A (com GenomaFlow) — fez exames, consulta, tratamento. Não gostou. Procura Clínica B (também com GenomaFlow). Quer levar histórico clínico sem precisar carregar exames físicos, recontar anamnese, refazer alergias/comorbidades, etc.

Hoje: cada clínica é tenant isolado por RLS. Não existe nenhum mecanismo de identidade global de paciente nem de compartilhamento entre tenants.

---

## 1. Premissa fundamental — quem é dono do quê

| Entidade | Dono | Base legal |
|---|---|---|
| **Identidade do paciente** (CPF, nome, contato) | **Paciente** | LGPD Art. 18 (titular) |
| **Histórico clínico** (encounters, exames, prescrições) | **Compartilhado**: clínica é controladora; paciente tem direito de cópia/portabilidade | LGPD Art. 18, V; CFM 1.821/2007 |
| **Prontuário formal** (versão da clínica) | **Clínica** (deve guardar 20 anos humano / 5 anos vet) | CFM/CFMV |
| **Cópia portada** | Da nova clínica que importou | LGPD Art. 7º + Art. 11, II, f (saúde) |

Conclusão: o **dado** é replicável; a **integridade do registro original** é da clínica que assinou.

---

## 2. Três modelos arquiteturais

### A) Portabilidade sob demanda (mais simples)
Paciente exporta um pacote (PDF + JSON) da clínica A → leva pra clínica B → B importa como anexo read-only. Cada clínica vira uma "ilha" com cópia.
- **Vantagem**: zero federação, sem desafios cross-tenant em RLS.
- **Limitação**: snapshot fotografia, não atualiza.

### B) Identidade global + federação total (mais complexo)
Tabela `patient_citizens` no schema master (CPF como chave). Eventos clínicos ficam no tenant que criou. Tenants autorizados conseguem ler eventos de outros tenants via consent record.
- **Vantagem**: dados sempre atuais, single source per evento.
- **Risco**: RLS cross-tenant complicado, vazamentos sutis, governança difícil.

### C) Híbrido (recomendação) — Identity Provider + Importação Granular
- Cada paciente tem **identidade global** no GenomaFlow (`patient_citizens` com CPF único)
- Cada clínica continua tendo seu `subjects` próprio (mantém RLS atual intacto)
- Quando paciente vai à clínica B: B busca por CPF → se já existe `citizen_id`, B convida paciente a compartilhar histórico
- Paciente autentica (idealmente **gov.br**) → escolhe granularidade (todos exames? só últimos 12m? prescrições ativas? evoluções?) e período
- B recebe **pacote anexado** marcado como `"Histórico importado de [Clínica A] · DD/MM/AAAA · read-only"`
- Atualizações futuras só ocorrem se paciente reautorizar (Fase 4)

---

## 3. Requisitos LGPD (compliance)

| Item | Detalhe |
|---|---|
| **Base legal** | Consentimento (Art. 7º, I) + Tutela da saúde (Art. 11, II, f) |
| **Consentimento granular** | Específico, finalidade declarada, revogável a qualquer momento |
| **Minimização** | Paciente escolhe o que compartilhar (não tudo automático) |
| **Auditoria imutável** | Log de quem importou, quando, com qual escopo (reutilizar `audit_log` com `actor_channel='data_share'`) |
| **Direito de revogação** | Paciente revoga acesso → tenant destino deve cessar uso (mas pode reter pra prontuário CFM) |
| **Direito de eliminação** | Paciente pede apagamento → conflita com retenção 20 anos CFM. Solução: **pseudonimização** (apaga PII, mantém dado clínico anonimizado) |
| **DPO em cada tenant** | Cada clínica tem encarregado; GenomaFlow tem o seu |
| **Notificação de breach** | Tenant que recebeu dados é responsável por avisar se vazar (Art. 48) |
| **Termo de uso específico** | Separado do consentimento de tratamento — paciente assina especificamente "autorizo Clínica B a importar dados clínicos da Clínica A" |

---

## 4. Requisitos CFM / CFMV

- **CFM 1.821/2007** — prontuário eletrônico requer **assinatura digital ICP-Brasil** para dispensar papel. Hoje há `encounter.signed_at` mas não em ICP-Brasil — vale roadmap de assinatura digital qualificada
- **CFM 2.314/2022 (telemedicina)** — paciente tem direito a cópia do prontuário; clínica não pode reter exclusivamente
- **CFMV 1.275/2019** — análogo para veterinária
- **Inalterabilidade**: encounter/exame **assinado é imutável**. Dado portado deve preservar a assinatura original do médico que criou. A clínica B vê quem assinou na clínica A (audit trail clínico)

---

## 5. Requisitos técnicos

### Schema novo (proposta)
```sql
patient_citizens (master schema, sem RLS por tenant):
  id UUID PK
  cpf_hash TEXT UNIQUE NOT NULL
  cpf_last4 TEXT
  name TEXT
  birth_date DATE
  email TEXT
  phone TEXT
  identity_verified_at TIMESTAMPTZ  -- gov.br confirmou
  created_at TIMESTAMPTZ

ALTER TABLE subjects ADD COLUMN citizen_id UUID NULL REFERENCES patient_citizens(id);
  -- Mantém subject_id local (não quebra RLS), agrega com identidade global

data_share_consents:
  id UUID PK
  citizen_id UUID NOT NULL
  source_tenant_id UUID NOT NULL  -- de quem está saindo
  target_tenant_id UUID NOT NULL  -- pra quem está indo
  scope JSONB NOT NULL  -- {types:['exams','prescriptions','encounters'], period:'12m', from:'2025-05-01'}
  granted_at TIMESTAMPTZ NOT NULL
  revoked_at TIMESTAMPTZ NULL
  valid_until TIMESTAMPTZ NULL
  granted_by_method TEXT  -- 'gov_br' | 'otp_email' | 'otp_sms'
  ip_address INET
  user_agent TEXT

data_share_imports:
  id UUID PK
  consent_id UUID NOT NULL
  imported_at TIMESTAMPTZ
  package_hash TEXT  -- SHA-256 do pacote
  items_count INT
```

### Pacote de exportação
- Formato: **FHIR R4** (padrão internacional de interop) ou JSON proprietário versionado
- Hash SHA-256 + assinatura digital da clínica origem
- Criptografia: HTTPS em trânsito; envelope encryption do payload se baixado pelo paciente
- Versionamento: `package_schema_version` pra evoluir sem breaking

### Endpoints
```
POST /citizens/by-cpf                       (lookup ou cria identidade)
POST /citizens/:id/share-invitations        (clínica B convida)
GET  /portal/share-invitations              (paciente lista pendentes)
POST /portal/share-invitations/:id/grant    (paciente autoriza)
POST /portal/share-invitations/:id/revoke   (paciente revoga)
POST /citizens/:id/export-package           (gera pacote do tenant origem)
POST /citizens/:id/import-package           (importa no tenant destino)
GET  /master/data-share-audit               (master vê todos os shares)
```

### Autenticação do paciente (crítico)
- **gov.br** (Receita Federal) é o gold standard — CPF + biometria
- Alternativa: OTP (email + SMS) com fluxo de validação dupla
- **Nunca** simple senha — risco de roubo de identidade

### RLS
- `patient_citizens` é **sem RLS por tenant** (é entidade global)
- `data_share_consents` e `data_share_imports` têm RLS dupla (`source_tenant_id` E `target_tenant_id` podem ler)
- Ao importar: cria `subjects` no tenant destino com `citizen_id` apontando + insere encounters/exames com flag `imported_from_tenant_id` (read-only forever)

### Marcação visual
Cada item importado deve ter UI que indique:
- "Importado de [Clínica A]" badge
- Data da importação
- Quem assinou originalmente (médico da clínica A, com CRM)
- Read-only (não editável na clínica B; B só anexa novos eventos)

---

## 6. UX

**Médico (clínica B)** quando cadastra paciente:
1. Digite CPF → backend faz lookup em `patient_citizens`
2. Se existe e tem histórico em outra clínica:
   `"Este paciente já tem cadastro em outra clínica GenomaFlow. Quer convidá-lo a compartilhar histórico?"`
3. Botão "Enviar convite" → email/SMS pro paciente

**Paciente** (portal):
1. Recebe link → autentica via gov.br
2. Tela: "Clínica B (Dr. Y) está pedindo acesso ao seu histórico"
3. Granularidade:
   - [x] Exames (últimos 12 meses)
   - [x] Prescrições ativas
   - [ ] Evoluções clínicas
   - [ ] Vacinas
4. Botão "Autorizar"
5. Pode revogar a qualquer momento na conta

**Médico (clínica A — origem)**:
- Notificação opcional: "Paciente X autorizou Clínica B a importar histórico" (transparência, não bloqueia)

---

## 7. Trade-offs e riscos

| Risco | Mitigação |
|---|---|
| Clínica destino faz mau uso | Audit trail imutável + contrato operador + DPO responsável |
| Paciente revoga, mas dado já está copiado | Pseudonimização (mantém dado clínico, apaga PII) |
| Conflito CFM (reter 20 anos) × LGPD (apagar) | Base legal "tutela da saúde" Art. 11 prevalece pra dado clínico; PII pode ser anonimizada |
| Versão desatualizada na clínica destino | Convites de "atualização" periódicos (Fase 4) |
| Identidade duplicada (CPF errado) | gov.br como fonte de verdade |
| Clínica destino edita dado original | **Proibido por design** — `imported_from_tenant_id IS NOT NULL` ⇒ read-only forever |

---

## 8. Roadmap sugerido

| Fase | Entrega | Esforço |
|---|---|---|
| **1 — Portabilidade simples** | Paciente baixa pacote PDF+JSON; clínica B importa upload manual | Pequeno |
| **2 — Identity Provider** | `patient_citizens` + lookup por CPF + login portal via OTP | Médio |
| **3 — Compartilhamento federado** | Convites, granularidade, consent registry, audit cruzado | Grande |
| **4 — Atualizações automáticas** | Re-share quando origem registra novo evento | Médio |
| **5 — Assinatura ICP-Brasil + FHIR R4** | Compliance CFM total + interop fora do GenomaFlow | Grande |

---

## Próximos passos (quando retomar)

1. Decidir fase de início (sugerido: Fase 1 — MVP de baixo risco)
2. Levantamento jurídico:
   - Contrato de operador entre GenomaFlow e cada clínica
   - Termo específico de compartilhamento (separado do consentimento de tratamento)
   - Política de retenção em caso de revogação
3. Brainstorming técnico detalhado da fase escolhida (rodar `superpowers:brainstorming`)
4. Spec formal de design + plano de implementação
