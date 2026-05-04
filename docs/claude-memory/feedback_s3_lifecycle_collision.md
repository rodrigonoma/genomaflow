---
name: S3 lifecycle vs persistência — separar prefix de uploads efêmeros e persistentes
description: Bucket genomaflow-uploads-prod tem lifecycle de 7d em uploads/ — qualquer asset persistente deve ir pra prefix diferente, senão some sem aviso
type: feedback
---

O bucket `genomaflow-uploads-prod` tem lifecycle rule `delete-processed-uploads` com `Filter: Prefix "uploads/"` e `Expiration: 7 days`. **Qualquer objeto em `uploads/*` é apagado automaticamente após 7 dias** — sem retorno, sem notificação, sem soft-delete.

**Why:** 2026-05-04 — usuário reportou "imagens com marcadores não aparecem mais nos exames antigos". Investigação:
1. Frontend chama `GET /api/exams/:id/image` → API tenta baixar do S3 → retorna 500 com "The specified key does not exist."
2. Banco tem `original_image_url = s3://.../uploads/{tenant}/{exam}/image.png` populado corretamente
3. Mas o objeto S3 foi apagado pelo lifecycle (exame de 13 dias atrás, > limite de 7d)
4. Causa raiz: worker (`apps/worker/src/processors/exam.js`) salvava PNG processado em `uploads/${tenant_id}/${exam_id}/image.png` — mesmo prefix que tem lifecycle de 7d

Lifecycle foi setado out-of-band (não está no CDK), provavelmente com a intenção de purgar uploads originais (PDF/DICOM brutos) que o worker já processou. Mas o PNG renderizado pra exibir os bounding boxes no frontend foi salvo no mesmo prefix por engano.

**How to apply:**

1. **Distinguir prefixes por intenção de retenção:**
   - `uploads/` — material bruto efêmero (uploads de usuário, fontes processadas e descartáveis). Lifecycle 7d OK.
   - `exam-images/` — imagens displayable de exames (renderizações, PNGs de bounding box overlay). **Sem lifecycle**. Imagens médicas exigem retenção longa por CFM.
   - `inter-tenant-chat/`, `master-broadcasts/` — anexos de chat/comunicados, sem lifecycle.

2. **Ao adicionar feature que persiste asset visual ou de longo prazo:** *jamais* salvar em `uploads/`. Criar prefix novo + adicionar à IAM policy do task role (ver `feedback_iam_s3_prefixes.md`).

3. **Antes de mudar lifecycle ou adicionar nova rule:** auditar TODO asset persistente que vive no bucket. Comando:
   ```bash
   aws s3api get-bucket-lifecycle-configuration --bucket genomaflow-uploads-prod
   ```

4. **Defesa em profundidade na API:** quando rota faz `downloadFile()` em chave que pode ter sido purged, capturar `NoSuchKey` e retornar 404 limpo (não 500). Frontend trata 404 com fallback ("imagem não disponível"); 500 vira erro genérico ruim.

5. **Trazer lifecycle pro CDK quando possível:** out-of-band é dívida latente (`feedback_cdk_drift.md`). Se algum dia rodarem `cdk deploy s3-stack`, a lifecycle some. Ainda não foi pra IaC porque o bucket atual não é gerenciado por CDK — quando migrar, levar a rule também.

**Red flags:**
- Salvar em `uploads/${tenant}/${exam}/image.png` ou path similar que cai em lifecycle
- Endpoint que retorna 500 com "The specified key does not exist" / "NoSuchKey"
- `downloadFile()` sem try/catch em rota de produção
- Asset que precisa retenção médica longa (exames, laudos, prescrições) salvo em prefix com expiração curta

**Backlog perdido:** exames processados antes deste fix com `original_image_url` apontando pra `uploads/` já tiveram a imagem apagada pelo lifecycle (e a fonte original também — mesma prefix). Não há recuperação. Reprocess falha porque a fonte (PDF/DICOM/JPG bruto) também foi purged. Aceitar perda como dívida histórica.

**Commit do fix:** branch `fix/preserve-exam-images` em 2026-05-04. Worker passa a salvar em `exam-images/` + IAM policy do task role estendida + try/catch NoSuchKey na API.
