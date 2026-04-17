# GenomaFlow — Landing Page Institucional

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar o site institucional estático do GenomaFlow em `apps/landing/index.html`, fiel ao design system "Surgical Editorial", totalmente em PT-BR (termos técnicos em inglês), com CTA para cadastro de novos usuários.

**Architecture:** Arquivo HTML único com Tailwind CDN e Material Symbols. Sem framework, sem build step — deployável como arquivo estático em qualquer CDN ou Nginx. Imagens geradas via SVG/CSS inline (sem dependências externas de imagem). Links CTA apontam para `http://localhost:4200/onboarding` (ajustável por variável no topo do arquivo).

**Tech Stack:** HTML5, Tailwind CSS CDN, Material Symbols (Google Fonts), Space Grotesk + Inter + JetBrains Mono (Google Fonts), SVG inline.

---

## Design System

Segue exatamente o `prototipo/institucional/DESIGN.md`:

- **Cores**: palette definida no tailwind.config do protótipo (`surface: #0b1326`, `primary: #e1dfff`, `secondary: #c0c1ff`, etc.)
- **Tipografia**: Space Grotesk (headlines), Inter (body), JetBrains Mono (dados, monospace)
- **Regra No-Line**: separação por background shift, nunca por bordas sólidas 1px
- **AI Border**: `border-left: 2px solid #585990` nos cards de IA
- **Glass Card**: `background: rgba(192,193,255,0.1); backdrop-filter: blur(20px)`
- **Border radius**: 0.125rem default, 0.25rem large — estilo clínico, sem arredondamento consumer

---

## Estrutura de Arquivos

```
apps/landing/
  index.html          ← arquivo principal (tudo inline)
```

---

## Seções

### 1. Nav (fixo, topo)
- Logo "GenomaFlow" (Space Grotesk, cor `#c0c1ff`)
- Links âncora: `#modulos`, `#pipeline`, `#precos`, `#seguranca`
- Botão secundário: "Acessar Plataforma" → `APP_URL/login`
- Botão primário destaque: "Começar Grátis" → `APP_URL/onboarding`
- Background: gradiente `from-[#0b1326] via-[#1a1f2e] to-[#0b1326]`

### 2. Hero
- Badge: `pulse-indicator` + "Sistema: Inteligência Ativa"
- Título H1 (7xl, bold, tracking-tighter): "Inteligência Clínica em Tempo Real."
- Subtítulo: "Transforme laudos PDF em insights clínicos estruturados para médicos e veterinários. Pipeline multi-tenant com latência abaixo de 60 segundos."
- CTA primário: "Começar Agora — 15 minutos para integrar" → `APP_URL/onboarding`
- CTA secundário: "VER DOCUMENTAÇÃO.EXE" (monospace, sublinhado)
- Visual direito: SVG abstrato gerado — grade hexagonal com nós conectados em tons índigo/violeta, opacidade 20%, mix-blend-mode screen

### 3. Divisor "Intelligence Pulse"
- Linha fina `outline-variant/30` + `pulse-indicator` central

### 4. Módulos (grid assimétrico 12 colunas)
**Coluna esquerda (5 cols) — Módulo Humano:**
- Label: `HUMAN MODULES`
- Título: "Módulo Humano"
- Descrição: "Suporte à decisão clínica para vias metabólicas, cardiovasculares e hematológicas complexas."
- Glass card com ai-border: terminal simulado mostrando análise cardiovascular em andamento
- 2 métricas: "0.98 Precision Score" + "METAB-1 Active Engine"

**Coluna direita (7 cols, offset mt-24) — Módulo Veterinário:**
- Label: `VETERINARY MODULES`
- Título: "Módulo Veterinário"
- Descrição: "Pipelines de IA específicos por espécie para nutrição, terapêutica e automação diagnóstica."
- 2 glass cards: "IA Espécie-Específica" + "Nutrição Clínica"
- Barra de status: "PIPELINE ATIVO: EQUINE_ORTHO_V4 — 92% Inference Match"

### 5. Pipeline de Inteligência (bento grid, fundo `surface-container-lowest`)
- Título: "Pipeline de Inteligência Clínica"
- Subtítulo monospace: "SaaS Multi-tenant | RAG com pgvector | Insights < 60s"
- Grid 4 colunas auto-rows:
  - **Síntese Multimodal** (2×2): PDF, DICOM, HL7/FHIR, OCR
  - **Integration Studio** (2×1): endpoint `POST /api/v1/ingest` com resposta `200 OK`
  - **Histórico Longitudinal** (1×1): ícone timeline + descrição
  - **RAG Ready** (1×1): ícone database + pgvector

### 6. Preços (`id="precos"`)
**Layout 2 colunas:**

**Esquerda — texto:**
- Título: "Escalonamento Flexível"
- Descrição: "Assine a plataforma e compre créditos conforme o consumo. Cada agente de IA executado consome 1 crédito."
- Checklist: Multi-tenant, RAG prioritário, Suporte

**Direita — cards:**

Card 1 — Assinatura (destacado com `scale-105`, border secondary/20):
```
ASSINATURA MENSAL
R$ 199,00/mês
─────────────────
✦ Acesso completo à plataforma
✦ Todos os módulos habilitados
✦ Suporte 8/5
─────────────────
[Assinar agora] → APP_URL/onboarding
```

Card 2 — Créditos:
```
CRÉDITOS DE CONSUMO
R$ 0,49 / crédito
─────────────────
100 créditos   → R$ 49,90
250 créditos   → R$ 109,90
500 créditos   → R$ 199,90
─────────────────
[Comprar créditos] → APP_URL/onboarding
```

**Banner promoção** (abaixo dos cards, glass card com ai-border):
```
✦ OFERTA DE BOAS-VINDAS
No primeiro mês, 30% do valor da assinatura é convertido
em créditos grátis. R$ 199,00 → ~122 créditos inclusos.
Válido na primeira assinatura.
```

### 7. Segurança & Compliance (`id="seguranca"`, border-left 4px secondary)
- Título: "Conformidade Regulatória & Clínica"
- Texto: disclaimer de suporte à decisão clínica + ANVISA + LGPD + CFM
- Badges: `ANVISA CERTIFIED` | `LGPD COMPLIANT` | `CFM R-891-2`
- Destaque direito: "256-bit AES Data Encryption"

### 8. Footer
- Esquerda: "GenomaFlow Sentinel v2.4.0" + copyright
- Direita: links LGPD, ANVISA, Documentação, Status do Sistema

---

## Variável de Configuração

No topo do `<script>` do arquivo, antes do tailwind.config:
```js
const APP_URL = 'http://localhost:4200';
// Em produção: const APP_URL = 'https://app.genomaflow.com.br';
```

Todos os links CTA usam `APP_URL` via JavaScript no `onload` ou `href`.

---

## Imagens (SVG inline gerado)

Substituir a `<img>` do hero por SVG inline:
- Grade de hexágonos pequenos (stroke `#c0c1ff` opacity 0.3)
- Nós circulares conectados por linhas finas (simulando rede neural)
- Gradiente radial índigo no centro
- Dimensões: fill do container, viewBox="0 0 800 600"

---

## Fora de Escopo

- SEO meta tags avançadas
- Analytics / tracking
- Formulário de contato
- Blog ou conteúdo dinâmico
- Multi-idioma
