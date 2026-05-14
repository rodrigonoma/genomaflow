# Consentimento Reforçado e Privacidade — Guia do Profissional de Estética

> **Módulo:** Estética (`module = estetica`)
> **Namespace RAG:** `product_help`
> **Atualizado em:** 2026-05-12

---

## Quando se aplica

Regiões anatômicas sensíveis exigem **consentimento reforçado adicional** além do consent operacional padrão:

- **Mama / Tórax** (`breast`)
- **Glúteos** (`glutes`)
- **Abdômen** (`abdomen`)

Sem o consent reforçado registrado, o sistema bloqueia tanto o upload quanto a análise dessas regiões com erro `CONSENT_REINFORCED_MISSING`.

---

## Como obter

1. **Offline (na clínica)** — Converse com o cliente, explique o uso da foto pela IA, registre o consentimento por escrito conforme normativa LGPD.
2. **No sistema** — Ao escolher uma região sensível pela primeira vez, o modal de consentimento abre em **modo reforçado**:
   - Disclaimer destacado em laranja (retenção LGPD 1 ano + auto-blur via IA)
   - Lista das regiões cobertas (ex: "breast")
   - Checkbox específico: "Confirmo o consentimento reforçado para a(s) região(ões) sensível(eis) acima"
   - Campo de nome do profissional + data automática
3. O consent é UPSERT — se já existe para o cliente, o sistema adiciona a região ao array `reinforced_regions` sem perder regiões anteriores.

---

## Auto-blur via IA (opcional)

Para fotos sensíveis, o sistema oferece auto-blur ANTES do upload ao S3:

1. Você marca o checkbox "Aplicar auto-blur" no uploader (ativo por default em regiões sensíveis).
2. O sistema chama Sonnet Vision para detectar bbox de áreas íntimas (mamilo, genital, areolar).
3. `sharp` aplica **pixelização** (default, 16-block) ou **gaussian blur** (alternativo, sigma 30) nas coordenadas detectadas.
4. **Modal de preview** abre com a foto original vs. a foto borrada, lado a lado. Você revisa antes de confirmar.
5. 3 botões:
   - **Aceitar e enviar com blur** — Sobe o buffer borrado.
   - **Enviar SEM blur** — Sobe o original (você já cropou manualmente fora do sistema).
   - **Cancelar** — Aborta o upload.

A detecção pode ter falsos positivos/negativos. A revisão visual é obrigatória pra você decidir.

---

## Retenção e privacidade

- **Fotos padrão** (não sensíveis): retenção **5 anos** (alinhado CFM).
- **Fotos sensíveis**: retenção **1 ano** (LGPD biometria).
- Após o prazo, fotos são purgadas automaticamente por job diário (04:00 BRT):
  - Soft delete na tabela `aesthetic_photos` (`deleted_at = NOW()`)
  - Delete do objeto no S3 (best-effort, falha → warn log)
  - Audit log captura via `actor_channel='system'`

A retenção é configurável pela administração (`AESTHETIC_SENSITIVE_RETENTION_DAYS`) caso a clínica precise reter mais tempo por razões legais específicas.

---

## Criptografia at-rest

Todas as fotos (sensíveis ou não) são armazenadas em S3 com criptografia **AES-256 default**. Acesso via URLs assinadas com TTL de 1 hora. Nenhuma foto é acessível fora da sua clínica (RLS multi-tenant + ACL).

---

## Erros possíveis

| Erro | Significado | Como resolver |
|---|---|---|
| `CONSENT_MISSING` | Cliente não tem consent operacional padrão | Registre o consent geral primeiro |
| `CONSENT_REINFORCED_MISSING` | Tentativa de análise de região sensível sem reforço para essa região específica | Re-abra o modal de consent — o sistema oferece o modo reforçado automaticamente |
| `PREVIEW_FAILED` | Auto-crop preview falhou (Sonnet Vision indisponível) | Tente novamente; se persistir, suba sem auto-blur OU contate suporte |

---

## Disclaimer regulatório

> **Fotografias de regiões anatômicas sensíveis (mama, glúteos, abdômen) são tratadas como dado biométrico sensível conforme LGPD. O profissional responsável pela clínica declara, ao confirmar o consentimento reforçado no sistema, que obteve autorização específica do paciente para a coleta, análise por IA e armazenamento dessas imagens. A guarda do consentimento físico assinado é responsabilidade da clínica.**

---

## FAQ

### Posso desativar o auto-blur?

Sim — o auto-blur é opt-in. Mas a recomendação é mantê-lo ativo (default) para reduzir exposição de dados sensíveis. Auto-blur NÃO substitui o consent reforçado — você precisa de ambos.

### Falsos positivos no auto-blur?

A IA pode borrar áreas não-sensíveis erroneamente OU deixar passar áreas que deveria borrar. A revisão visual no modal de preview é obrigatória — você decide se aceita ou não. Documente o motivo da decisão clínica no prontuário.

### Posso revogar o consent reforçado?

Hoje o sistema não tem endpoint de revogação granular por região. Para revogação total (direito ao apagamento LGPD), use `DELETE /aesthetic/photos/:id` ou contate o suporte.

### Por que regiões sensíveis têm retenção menor?

LGPD trata dados biométricos com proteção reforçada. 1 ano é prazo conservador que cobre tratamento + algumas reanálises de evolução. Após esse prazo, a manutenção do dado deixa de ser necessária para a finalidade declarada.

### O cliente pode acessar essas fotos?

Não diretamente — o sistema é uso interno da clínica. Para compartilhar com o cliente, baixe o PDF do protocolo (que NÃO inclui fotos sensíveis por padrão) ou imprima localmente.

### Quem pode acionar a purga manualmente?

Apenas usuários com role=master. Em casos especiais (cliente solicitou apagamento imediato, incidente de segurança, etc.), o master pode disparar `POST /master/aesthetic-purge-sensitive/run-now` que força a execução do job de purga via Redis pub/sub.

### O audit_log mostra quem viu uma foto sensível?

Sim — todo acesso a foto sensível dispara entry em audit_log via trigger automático. Master pode visualizar em `/master/audit-log`. Atributos: `actor_user_id`, `actor_channel`, `created_at`, `entity_id`.
