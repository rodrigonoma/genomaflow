# Análise Corporal por IA — Guia do Profissional de Estética

> **Módulo:** Estética (`module = estetica`)
> **Namespace RAG:** `product_help`
> **Atualizado em:** 2026-05-12

---

## Como funciona

A análise corporal é uma extensão da análise facial para regiões do corpo. O fluxo:

1. **Registrar consentimento** — Operacional padrão (1× por cliente). Para regiões sensíveis (mama, glúteo, abdômen), o sistema exige **consentimento reforçado adicional** — veja [Consentimento Reforçado](aesthetic-consent-reforcado.md).
2. **Escolher a região** — O seletor mostra 6 áreas anatômicas disponíveis: pernas, glúteos, abdômen, braços, mama, corpo inteiro.
3. **Seguir o guia de fotos** — Cada região tem requisitos visuais específicos (enquadramento, distância, peças de roupa, ângulo). O sistema mostra um guia antes do upload.
4. **Enviar a foto** — Mesmo limite de 5MB, JPEG/PNG, mesmas regras de qualidade.
5. **Aguardar processamento** — Tempo similar à análise facial (<60s). Worker usa o agente corporal (`aesthetic-body.js`) ao invés do facial.
6. **Visualizar resultado** — Score 0-100 por métrica + anotações SVG + recomendações de protocolo do catálogo.
7. **Comparar antes/depois** — Versão expandida da comparação facial: 2 fotos lado a lado com overlays SVG sobrepostos.

---

## Regiões e métricas (29 métricas corporais)

| Região | Métricas |
|---|---|
| **legs** (pernas) | culote_esquerdo, culote_direito, celulite_coxas, estrias_coxas, firmeza_coxas, flacidez_interna_coxa (6) |
| **glutes** (glúteos) | firmeza_gluteos, celulite_gluteos, estrias_gluteos, projecao_glutea (4) — **sensível** |
| **abdomen** | flacidez_abdominal, estrias_abdominais, manchas_abdominais, volume_aparente_abdomen, diastase_visivel (5) — **sensível** |
| **arms** (braços) | flacidez_triceps, manchas_brazos, textura_brazos, celulite_brazos, firmeza_brazos (5) |
| **breast** (mama/tórax) | ptose_mamaria, simetria_mamaria, volume_aparente, qualidade_pele_torax (4) — **sensível** |
| **full_body** (silhueta completa) | proporcao_corporal, postura_visual, simetria_global, volume_aparente_global (4) |

Cobertura total da plataforma (F1 facial + F2 corporal): **40 métricas**.

---

## Regiões sensíveis

Mama, glúteos e abdômen são marcadas como sensíveis. Isso ativa:

1. **Consent reforçado obrigatório** — Sem o consentimento específico registrado, a análise é bloqueada com erro `CONSENT_REINFORCED_MISSING`.
2. **Auto-blur opcional** — Antes do upload, o sistema pode aplicar blur pixelizado em áreas íntimas (mamilo, genital) detectadas pela IA. O profissional pode visualizar o resultado antes de confirmar.
3. **Retenção reduzida** — Fotos sensíveis ficam armazenadas por 1 ano (vs. 5 anos para fotos padrão), conforme LGPD. Após esse prazo são automaticamente purgadas.

Veja: [Consentimento Reforçado e Privacidade](aesthetic-consent-reforcado.md).

---

## Comparação antes/depois

A comparação corporal é mais robusta que a facial:

1. **Seleção** — Escolha "baseline" (foto anterior) + "atual" (foto recente) da mesma região.
2. **Overlay duplo** — Os SVGs de ambas as fotos são exibidos sobrepostos para facilitar a comparação visual.
3. **Toggle baseline overlay** — Botão "Mostrar contorno do antes sobreposto" permite ativar/desativar o overlay da foto antiga.
4. **Delta matemático** — Cada métrica recebe um indicador de melhora (↑) ou piora (↓) calculado sem chamada IA adicional.

---

## Limitações honestas

- **Medições absolutas em cm² não são confiáveis** via foto 2D. Os scores de 0-100 refletem severidade visual, não medida clínica.
- **Comparativo antes/depois** é visual + delta de scores, não medição numérica precisa.
- **Iluminação inconsistente** entre baseline e atual pode gerar falsos positivos/negativos. Recomendação: padronizar setup fotográfico (mesma luz, mesma roupa, mesma posição).

---

## Disclaimer regulatório

> **Os resultados desta análise são gerados por inteligência artificial e têm caráter exclusivamente informativo. Não constituem diagnóstico médico, laudo clínico nem prescrição de tratamento. A interpretação e a tomada de decisão são de responsabilidade exclusiva do profissional habilitado (CFM/CFE/CRN).**

---

## FAQ

### Quanto custa uma análise corporal?

Mesmo custo da análise facial: **5 créditos** por análise (independente da região).

### Posso analisar várias regiões na mesma sessão?

Sim. Cada região é uma análise separada (= 5 créditos cada). O cliente precisa concordar com consentimento reforçado uma única vez para cada região sensível.

### O auto-blur é obrigatório para regiões sensíveis?

Não — você pode optar por enviar a foto sem auto-blur se já recortou manualmente fora do sistema. Mas a recomendação é manter o auto-blur ativo (default) para reduzir exposição de dados sensíveis.

### Fotos sensíveis ficam quanto tempo armazenadas?

**1 ano** após o upload (vs. 5 anos para fotos padrão). Depois disso são purgadas automaticamente. Esse prazo é configurável pela administração (`AESTHETIC_SENSITIVE_RETENTION_DAYS`) caso a clínica precise reter mais tempo por razões legais específicas.

### Posso re-analisar a mesma foto?

Sim — o sistema não impede duplicatas. Cada análise é cobrada (5 créditos). Para evitar consumo desnecessário, use a comparação antes/depois para evolução, que não consome créditos adicionais.

### O que acontece se a IA não conseguir analisar a região?

Se a falha for técnica (`NO_BODY_DETECTED`, `IMAGE_TOO_BLURRY`, `BAD_LLM_OUTPUT`), os 5 créditos são estornados automaticamente. Você recebe notificação com o motivo.
