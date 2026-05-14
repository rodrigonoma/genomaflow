---
name: S3 lifecycle vs persistência — bucket sem lifecycle desde 2026-05-04
description: Bucket genomaflow-uploads-prod tinha lifecycle 7d em uploads/ que apagou imagens displayable de exames. Removida; ativos persistem indefinidamente. Worker passou a salvar imagens em prefix dedicado (exam-images/) por hygiene organizacional, mesmo sem pressão de lifecycle.
type: feedback
---

**Estado atual (desde 2026-05-04):** o bucket `genomaflow-uploads-prod` não tem lifecycle rule. **Todos os objetos persistem indefinidamente.** Plano de expurgo/backup pra outro bucket fica como dívida técnica futura — a definir cadência, retenção e destino.

**Por quê removemos:** uma única rule `delete-processed-uploads` com `Filter: Prefix "uploads/"` e `Expiration: 7 days` estava purgando objetos depois de uma semana. Isso quebrou o GET /api/exams/:id/image pra qualquer exame com mais de 7 dias — banco mantinha `original_image_url` apontando pro objeto que o S3 já tinha apagado, API retornava 500 NoSuchKey, frontend caía na mensagem "imagem não disponível nesta versão". Incidente reportado 2026-05-04 por exame de RM de 2026-04-21 (13 dias antes).

Perda histórica: exames processados antes do fix tiveram tanto o objeto displayable (PNG renderizado) quanto a fonte original (PDF/DICOM/JPG bruto) apagados pelo lifecycle, ambos no mesmo prefix `uploads/`. **Sem recuperação possível.** Reprocess também falha porque a fonte sumiu.

## How to apply

1. **Confirmar que lifecycle continua removida:**
   ```bash
   aws s3api get-bucket-lifecycle-configuration --bucket genomaflow-uploads-prod
   # Deve retornar: NoSuchLifecycleConfiguration (erro esperado)
   ```

2. **Antes de adicionar lifecycle de volta no futuro:** identificar exatamente quais prefixes podem ser purgados sem perda funcional. Ativos médicos (exames, laudos com markers, prescrições, anexos clínicos) devem ficar fora de qualquer expiração — CFM exige retenção de prontuários por décadas.

3. **Ativos efêmeros candidatos a expurgo futuro:**
   - `uploads/*` raw user uploads se já processados (PDF/DICOM brutos podem ser descartados depois que worker já gerou o PNG displayable)
   - Sessões de chat antigas talvez (mas check com legal antes)
   - Anexos de testes / sandbox

4. **Ativos protegidos (NUNCA expirar):**
   - `exam-images/*` — PNGs displayable com markers (introduzido 2026-05-04)
   - `master-broadcasts/*` — anexos oficiais
   - `inter-tenant-chat/*` — conversas profissionais (verificar legal)

5. **Padrão preventivo no worker:** imagens displayable (DICOM convertido + JPG/PNG do user) salvam em `exam-images/{tenant_id}/{exam_id}/image.{ext}` desde o fix de 2026-05-04. Mesmo sem pressão de lifecycle hoje, mantém separação organizacional clara entre raw e processed.

6. **API defensive layer:** GET /:id/image captura `NoSuchKey` e retorna 404 limpo (em vez de 500). Cobre caso raro de objeto deletado manualmente ou referência órfã. Sem isso, frontend mostra erro genérico ruim em vez do fallback `noImage=true`.

## Red flags

- Adicionar lifecycle rule no bucket sem auditar TODO asset persistente
- Salvar PNG displayable em `uploads/` (volte a vir pra `exam-images/`)
- API que faz `downloadFile` sem try/catch numa rota crítica
- Endpoint que retorna 500 com "NoSuchKey" / "The specified key does not exist"
- Ativos médicos em prefix com expiração curta (CFM compliance)

## Dívida técnica registrada

**Plano de expurgo/backup futuro (TBD):**
- Definir RPO/RTO para imagens de exame
- Definir bucket destino (Glacier? S3 Standard-IA? bucket separado?)
- Definir gatilho (idade? tag? movimentação manual?)
- Decidir se uploads/ raw pode ser purgado depois de N dias (verificar dependência de reprocess)
- Documentar no IaC (CDK) quando finalizar — atualmente lifecycle estava out-of-band

**Commits relevantes:**
- 2026-05-04 fix `bccd9238` — worker → exam-images/, IAM, API try/catch + delete da lifecycle rule via aws CLI
