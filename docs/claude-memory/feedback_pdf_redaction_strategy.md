# PDF redaction — text-layer first, nunca rasterizar

## Regra
PDFs do chat entre tenants são redigidos em duas estratégias dependendo do conteúdo:

1. **PDF com text layer (digital, ~95% dos casos)** — `pdfjs-dist` extrai texto + posições de cada item, regex+Haiku classifica PII, `pdf-lib` desenha retângulos pretos diretamente nas coordenadas. **Não rasteriza.** Saída mantém o tamanho original do PDF e text layer.
2. **PDF escaneado (sem text layer)** — front mostra modal de aviso LGPD com checkbox de responsabilidade. Backend aceita `pdf.user_confirmed_scanned: true` pra pular o PII check (audit row registra `user_confirmed_scanned` em `detected_kinds`).

## Por quê
Tentamos primeiro V1.5 com rasterização (`pdf-to-png-converter` + Tesseract por página + Sharp). Rodou ~3 minutos pra 9 páginas e gerava payload >10MB (413 errors). Era o approach errado: PDFs médicos digitais já têm o texto extraível — rasterizar é jogar fora o sinal pra recriar com OCR.

A estratégia atual roda em 1-3s pro PDF típico, mantém qualidade do PDF (não vira imagem) e nem precisa de Tesseract pra digitais.

## Como aplicar
- Endpoint: `POST /inter-tenant-chat/images/redact-pdf-text-layer` retorna `{has_text_layer, ...}`. Front faz branch:
  - `has_text_layer && total_regions > 0` → modal de preview (`redact-pdf-preview-dialog`) com summary chips ("3 nomes · 1 CPF · 2 datas") + iframe do PDF redigido
  - `has_text_layer && total_regions === 0` → envia direto sem fricção
  - `!has_text_layer` → modal LGPD (`pdf-scanned-confirm-dialog`) com checkbox de responsabilidade
- Heurística de "tem text layer": `totalChars >= numPages * 30`. Abaixo disso é escaneado.
- Prompt do Haiku é conservador: lista explícita de exclusões médicas (ACL, T1, T2, FLAIR, AVC, etc.) pra não falsamente marcar termos clínicos como PII.
- `apps/api/src/imaging/pdf-text-redactor.js` é o módulo. Patterns PII duplicados de `redactor.js` (não compartilhado pra evitar acoplamento com OCR).

## Imagens — JPEG q=0.85
Canvas exporta como `image/jpeg` quality 0.85, **não PNG**. Reduz upload típico de 3MB → 300KB sem perda visível pra exames anonimizados (texto preto sobre fundo claro). PNG só vale a pena pra screenshots de UI ou imagens com transparência.

## Red flags
- Rasterizar PDF digital pra rodar OCR → 100x mais lento e payload gigante. Sempre tentar text-layer primeiro.
- Permitir PDF escaneado sem confirmação LGPD → vazamento por descuido. Modal com checkbox é o gate.
- `canvas.toDataURL('image/png')` em fluxos de upload de imagem médica → 10x mais bytes do que precisava. JPEG q=0.85 é o default.
- Compartilhar regex PII entre módulos via require cruzado → acoplamento ruim. Duplicar e sincronizar manualmente é menos pior nesse caso.

## Histórico
- 2026-04-25: V1 imagens com Tesseract + Haiku (canvas editor) ✓
- 2026-04-25: V1.5 PDFs com rasterização — rejeitada por performance/tamanho
- 2026-04-25: V2 PDFs com text-layer (pdfjs-dist + pd-lib) + JPEG q=0.85 pras imagens
