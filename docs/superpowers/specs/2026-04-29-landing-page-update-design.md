# Landing Page Update — Design Spec

**Data:** 2026-04-29
**Branch alvo:** `feat/landing-page-update`
**Arquivo principal:** `apps/landing/index.html`
**Domínio em prod:** `genomaflow.com.br` / `www.genomaflow.com.br` (apex/www → landing only; `app.genomaflow.com.br` é o Angular)

## Contexto e objetivo

Desde a última versão da landing, o produto entregou múltiplas features que repositionam o GenomaFlow de "ferramenta de análise de exames com IA" para **plataforma operacional clínica completa com IA no centro**. A landing atual ainda vende apenas a camada de IA — agenda, copilot por voz, chat entre clínicas, dashboard, prescrições, audit log e anonimização automática de PII não aparecem.

**Objetivo:** atualizar a landing para refletir o produto entregue, mantendo a polidez visual já alcançada (dark theme, Inter Tight + Fraunces + JetBrains Mono, paleta com accent vermelho cross), e atrair médicos e veterinários como leads B2B.

**Não-objetivo:** redesign visual ou troca de stack. Mantém HTML estático único, sem dependências novas.

## Premissas e decisões já tomadas

1. **Honestidade sobre métricas e selos.** Tirar logos fictícios de clientes (REDE UNIÃO, SÍRIO, PET CARE, GRUPO NOA), métricas inventadas (847k laudos, 312 clínicas, 99.94% uptime), e selos sem certificação real (ANVISA CERTIFIED, ISO 27001). Manter LGPD e CFM (reais). Substituir números por **estimativas honestas** com disclaimer ("estimativas baseadas em rotinas clínicas típicas").

2. **Posicionamento híbrido.** Hero foca na plataforma completa, mas IA continua protagonista. Logo após hero vem seção "3 Pilares" (IA Clínica / Operação / Compliance) que ancora a narrativa híbrida.

3. **Estrutura: single-page**. Mantém SPA-like com âncoras pra cada pilar. Páginas separadas seriam atrito desnecessário pro lead B2B brasileiro de clínica.

4. **Diferenciação Médico × Veterinário sem login: top bar + toggle no nav.** Top bar slim (36px) só na primeira visita destaca a escolha. Toggle "⚕️ Humano | 🐾 Vet" persistente no nav. Persistência em `localStorage`. Default (sem escolha) mostra ambos os perfis com peso igual.

5. **Pricing sem mudança.** R$ 199/mês + 4 pacotes de créditos. Adiciona linha "agenda, voz, chat, dashboard, compliance inclusos no plano base — créditos pagam só execução de agentes IA".

6. **CTAs: Criar conta + Entrar** (sem novo CTA "Agendar demo").

## Arquitetura da página (em ordem de scroll)

```
[1]  Top Bar (1ª visita)             — toggle Médico/Vet
[2]  Nav                             — logo, links, toggle persistente, ações
[3]  Hero                            — repivotada (plataforma completa)
[4]  Marquee                         — capabilities rolando (existente, ajustar copy)
[5]  3 Pilares                       — NOVO — substitui logos clientes fictícios
[6]  Módulos Human × Vet             — existente, reage ao toggle
[7]  Pilar 1: IA Clínica (#ia)       — F1 a F5 + Showcase + Pipeline
[8]  Pilar 2: Operação (#operacao)   — BLOCO TODO NOVO — O1 a O5
[9]  Pilar 3: Compliance (#compliance)— REFORÇADO — C1 a C6 em grid
[10] Impacto                          — KPIs estimados honestos
[11] Calculadora                      — input rotina, output ganho mensal estimado
[12] Preços                           — mantém + linha sobre o que tá incluso
[13] FAQ                              — 8 perguntas (3 novas: agenda, voz, PII)
[14] Footer CTA                       — copy ajustado
[15] Footer                           — links ajustados
```

## Detalhamento por seção

### [1] Top bar (primeira visita apenas)

- Faixa preta sólida 36px, sticky topo, z-index 110 (acima do nav).
- Texto centralizado em mono uppercase: `PERSONALIZE SUA EXPERIÊNCIA`.
- À direita: dois botões pill toggle "Atendo humanos" / "Atendo animais" com mesmo SVG inline do nav (estetoscópio + pegada), borders soft, hover suave. Sem emoji.
- Botão `×` discreto à direita pra dispensar.
- Após qualquer escolha (incluindo dispensa): `localStorage.setItem('genoma_persona', 'human'|'veterinary'|'both')` → animação slideUp e remove do DOM. Não volta nessa máquina.
- Mobile (<640px): empilha em 2 linhas — texto curto em cima, dois botões 44px touch-friendly embaixo.

### [2] Nav (sempre visível)

- Mantém estrutura: logo (esquerda), links (centro), ações (direita).
- **Adiciona** entre links e ações: pill toggle compacto `Humano | Vet` com ícones SVG inline (estetoscópio + pegada animal — não usar emoji por inconsistência cross-platform). Opção ativa em vermelho cross `var(--cross)`. Outra fica `var(--text-3)`.
- Comportamento: clique troca persona, toda landing reflete instantaneamente, persiste em `localStorage`.
- Mobile: pill move pra dentro do menu hamburger.
- Links no nav: `MÓDULOS · PRODUTO · PILARES · PREÇOS · FAQ`.

### [3] Hero (repivotado — coração da venda)

- **Tag** (mono uppercase): `Plataforma clínica com IA no centro`
- **Título display** (mantém escala 80–168px, line-height 0.88, weight 800, letter-spacing -0.05em):
  - Linha 1: `A clínica`
  - Arrow `↘` em text-3, fonte média
  - Linha 2: `que pensa`
  - Linha 3: `com você.` *(em Fraunces italic, accent vermelho)*
- **Subtítulo** (Inter Tight 18-20px, max-width 520px, color text-2):
  > "Da agenda à análise de exames, do laudo à prescrição, *uma só plataforma*. Inteligência artificial assistiva para suas decisões clínicas — auditável, multi-tenant e em conformidade com a LGPD."
  > <em class="hero-italic">Para humanos e animais.</em>
- **Ações:**
  - Primary: `Criar conta gratuita →` (vermelho cross), `data-cta="/onboarding"`
  - Ghost: `Já sou cliente · Entrar`, `data-cta="/login"`
  - Secundário texto: `Ver a plataforma em ação ↓`, ancora `#operacao`
- **Métricas (4 pills horizontais, mono, substituindo as fictícias):**
  - `~6–13 min` poupados na rotina (por exame complexo)
  - `5 agentes IA` no mesmo exame
  - `< 60s` PDF → insight
  - `99%` uptime garantido
- Disclaimer 11px abaixo do grid de métricas, color text-3:
  > *"Estimativas baseadas em rotinas clínicas típicas; resultados variam por especialidade e volume."*
- **Visual lateral direito**: cards flutuantes em camadas (z-stacked) mostrando preview de **agenda** (week grid mini), **análise IA** (risk card mini) e **chat** (message bubbles mini). Substitui o display antigo monoléquico de análise de exame.

### [4] Marquee (existente, ajustar copy)

Linha rolante com capabilities. Substitui itens fictícios atuais. Items separados por bullets vermelhos `·`:
```
ANÁLISE MULTI-AGENTE · IMAGEM DICOM · CHATBOT RAG · COMPARAÇÃO LONGITUDINAL ·
AGENDA NATIVA · COPILOT POR VOZ · PRESCRIÇÕES · CHAT ENTRE CLÍNICAS ·
DASHBOARD · ANONIMIZAÇÃO DE PII · AUDIT LOG · LGPD-FIRST
```

### [5] 3 Pilares (NOVA seção)

Função: ancorar narrativa híbrida e dar índice visual da plataforma. Substitui faixa de logos fictícios.

- **Header**:
  - Section label (mono uppercase): `Plataforma completa`
  - Heading: `Três pilares.<br/><em>Uma só plataforma.</em>` (Fraunces italic em "Uma só plataforma")
- **Grid 3 colunas** (mobile: 1 coluna empilhada):

  | Pilar | Heading | Sub | Bullets | CTA âncora |
  |---|---|---|---|---|
  | **IA Clínica** | "Inteligência que **lê e correlaciona**" | Análise multi-agente em tempo real, com fontes citadas e confiança auditável. | Multi-agentes paralelos · Imagens DICOM/RX/ECG · Chatbot RAG por paciente · Comparação longitudinal | `Ver IA Clínica ↓` → `#ia` |
  | **Operação** | "A clínica que **se organiza sozinha**" | Agenda, prescrições, comunicação entre clínicas e dashboard — tudo conversa entre si. | Agenda com voz · Prescrições com templates · Chat entre clínicas · Dashboard clínico | `Ver Operação ↓` → `#operacao` |
  | **Compliance** | "**LGPD pensada** desde o primeiro byte" | Anonimização automática de PII, audit log forense, consentimento e onboarding profissional verificado. | Anonimização automática · Audit log forense · Consentimento LGPD · CRM/CRMV verificado | `Ver Compliance ↓` → `#compliance` |

- **Estilo**: cards com `border: 1px solid var(--line)`, hover sobe 4px com `border-color: var(--cross)`. Tipografia heading mistura Inter Tight bold + Fraunces italic na palavra-chave (negrito acima). Linha vertical fina vermelha 2px no canto esquerdo de cada card.
- **Ícones SVG inline** (sem dep externa): gráfico de linhas (IA), calendário com check (Operação), escudo com cadeado (Compliance). Stroke vermelho cross, 32×32px.

### [6] Módulos Human × Vet (existente, reage ao toggle)

Mantém split atual em duas colunas. Mudanças:

1. **Reage ao toggle**: persona ativa fica destacada (`border-color: var(--cross)`, `transform: scale(1.02)`), outra esmaecida (`opacity: 0.6`). Sem persona definida (default): ambas com peso igual.
2. **Atualiza módulos pra refletir os agentes reais do worker:**

   **Humano**:
   - `METAB-1` Vias Metabólicas — glicemia, lipídios, função hepática/renal
   - `CARDIO-1` Risco Cardiovascular — perfil lipídico + correlações
   - `HEMA-1` Hematologia — hemograma, coagulograma, marcadores inflamatórios
   - `THERAP-1` Terapêutica — sugestão de conduta (suporte ao clínico)
   - `NUTRI-1` Nutrição clínica
   - `CORREL-1` Correlação clínica multi-marcador
   - `IMG-1` Imagens médicas — RX, ECG, US, RM, DICOM

   **Veterinário**:
   - `SMALL-1` Pequenos animais (canídeos, felinos)
   - `EQUUS-1` Equinos
   - `BOVINE-1` Bovinos
   - `THERAP-1` Terapêutica veterinária
   - `NUTRI-1` Nutrição animal por espécie/peso
   - `IMG-1` Imagens médicas veterinárias

3. **Layout**: 4 cards por coluna em grid 2×2 (não lista vertical). Cada card: código (mono) + nome (Inter Tight 16px bold) + 1 linha de descrição. Hover revela bullet de capabilities.

### [7] Pilar 1: IA Clínica (id="ia")

- **Header da seção**: tag `01 — IA Clínica` + heading `Cinco agentes. Um exame.<br/><em>Um insight auditável.</em>` (Fraunces em "Um insight auditável")
- **Showcase + Pipeline existentes**: ficam dentro deste pilar como prova
- **F1. Análise multi-agente** (existente, revisar copy: enfatizar "fontes citadas", "confiança calibrada", "disclaimer LGPD em todo resultado")
- **F2. Multi-agentes em paralelo** (existente, revisar: até 5 agentes simultâneos, custo em créditos visível em tempo real)
- **F3. Imagens médicas** (NOVO bloco):
  - Tag: `Pipeline DICOM`
  - Heading: `RX, ECG, ultrassom, ressonância.<br/><em>A IA também olha.</em>`
  - Body: "Faça upload de DICOM, JPG ou PNG. A IA classifica a modalidade, encaminha pro agente especializado e retorna o achado com **bounding boxes** sobre a imagem original. Suporte a RX, ECG, ultrassonografia e ressonância magnética."
  - Visual: vídeo de imagem médica com bounding boxes (vermelho/verde) animadas — placeholder até gravar o real
  - Bullets: "Vision classifier · 4 modalidades · Bounding boxes interativos · Disclaimer assistivo"
- **F4. Chatbot RAG clínico** (existente, refinar copy: "responde só com dados reais do paciente", "fonte citada em cada resposta", "consome créditos por consulta")
- **F5. Comparação longitudinal** (existente, refinar copy: deltas automáticos, alertas críticos sinalizados, evolução por marcador com line chart)

### [8] Pilar 2: Operação da clínica (id="operacao") — BLOCO NOVO

Esse é o WOW factor. 5 blocos alternados (texto-vídeo / vídeo-texto), mesma rítmica visual do Pilar 1.

- **Header**: tag `02 — Operação` + heading `A plataforma <em>vai além</em><br/>da análise clínica.` (Fraunces em "vai além")

- **O1. Agenda integrada**:
  - Tag: `Agenda nativa`
  - Heading: `A semana inteira em<br/><em>uma tela só.</em>`
  - Body: "Visualização semanal 7×15h, blocos por status (agendado, confirmado, concluído), drag-to-reschedule e detecção de conflito direto no banco. Consulta dura o que era pra durar mesmo se você mudar a configuração depois — princípio de imutabilidade do passado."
  - Bullets: "Slots de 30/45/60/75/90/105/120 min · Bloqueios por horário · Mobile-first com swipe entre dias · Free slots calculados em tempo real"
  - Visual: screenshot/mockup da `/agenda` (week grid) — placeholder até produzir

- **O2. Copilot por VOZ** ★ destaque máximo:
  - Tag: `Copilot por voz · Beta`
  - Heading: `Diga. Ele agenda.<br/><em>Diga. Ele cancela.</em>`
  - Body: "Pressione o microfone e fale: *'marca consulta para o João Silva amanhã às 14h, 60 minutos'*. O Copilot resolve o paciente, checa conflito, cria a consulta — e te pede confirmação antes de cancelar qualquer coisa. Áudio nunca sai do navegador."
  - Bullets: "Web Speech API nativa pt-BR · 5 ações server-side · Confirmação obrigatória pra cancelar · Defesa anti-prompt-injection · Audit log completo"
  - Visual: animação do botão de mic vermelho pulsante + transcrição aparecendo + ação executando — placeholder

- **O3. Prescrições com templates por clínica**:
  - Tag: `Prescrições`
  - Heading: `A IA propõe.<br/>Você ajusta.<br/><em>O PDF sai pronto.</em>`
  - Body: "Agentes terapêutico e nutricional sugerem prescrição com base no exame. Você revisa, ajusta, salva como template da sua clínica. PDF gerado client-side com identidade visual."
  - Bullets: "Templates por tenant · Salvar/aplicar/deletar · PDF jsPDF cliente · Disclaimer assistivo · Chip PR-xxxxxx por prescrição"

- **O4. Chat entre clínicas**:
  - Tag: `Comunicação clínica`
  - Heading: `Encaminhe.<br/>Pergunte. Compartilhe.<br/><em>Sem WhatsApp.</em>`
  - Body: "Conversa 1:1 admin↔admin entre clínicas do mesmo módulo. Diretório opt-in, convite com aceite, anexos com **redação automática de PII** antes de enviar. Reações, busca full-text em português, denúncias com suspensão automática."
  - Bullets: "PDF e imagens redigidos automaticamente · 6 reações em whitelist · Search ts_headline pt · Bloqueio bilateral · Mobile responsivo"
  - Visual: thread de chat com PDF mostrando regiões pretas sobre PII

- **O5. Dashboard clínico**:
  - Tag: `Dashboard`
  - Heading: `O pulso da sua<br/><em>clínica em uma tela.</em>`
  - Body: "KPIs em tempo real: alertas críticos com link, exames aguardando revisão, donut de risco da carteira, top marcadores alterados, bar chart 14 dias. Tudo atualiza via WebSocket — zero F5."
  - Bullets: "Atualização real-time · Alertas críticos com deeplink · Donut de risco · Top 5 marcadores · Bar chart 14d"

### [9] Pilar 3: Compliance & Segurança (id="compliance")

Argumento de venda forte pra clínicas que se preocupam com regulação. Layout: cards densos em grid 2×3 (mais técnico, menos cinematográfico).

- **Header**: tag `03 — Compliance` + heading `LGPD não é checkbox.<br/><em>É arquitetura.</em>` (Fraunces em "É arquitetura")
- **Sub-heading**: "Construímos GenomaFlow com isolamento multi-tenant from day one. Cada clínica em RLS estrito, audit log forense, consentimento documentado, anonimização automática. Conformidade não é um documento PDF — é o código rodando."

- **Grid 2×3 de cards** (cada card: ícone 28px + heading 18px bold + body 14px ~80 palavras):

  - **C1. Anonimização automática de PII** ★
    "Antes de qualquer anexo sair pra outra clínica, a plataforma extrai texto do PDF, identifica PII (nome, CPF, telefone, microchip, data de nascimento) com regex + Haiku 4.5 e desenha retângulos pretos sobre as posições. Mantém o text layer. Imagens passam por canvas editor com Tesseract+Haiku detectando texto sensível."
  - **C2. Audit log forense**
    "Toda mutação em pacientes, prescrições, exames e agenda gera linha imutável no audit_log: quem, quando, o que mudou (diff JSONB), de onde (UI, Copilot, sistema, worker). Master vê tudo, tenant só o seu. Append-only no Postgres — nem o admin apaga."
  - **C3. Consentimento LGPD do paciente**
    "Cadastro do paciente exige checkbox de consentimento + opção de baixar PDF de termo de consentimento gerado client-side com dados da clínica pré-preenchidos. Pronto pra arquivamento físico ou digital."
  - **C4. Onboarding profissional verificado**
    "5 documentos legais (contrato SaaS, DPA, política de incidentes, segurança, uso aceitável) com aceite registrado: hash SHA-256 do conteúdo + IP + user-agent + timestamp. Profissional declara CRM/CRMV + UF com checkbox de veracidade."
  - **C5. Single-session com sessão única**
    "Login emite jti único; segunda autenticação no mesmo usuário invalida a anterior. Snackbar avisa antes de deslogar — sem sessão fantasma em outra máquina."
  - **C6. Multi-tenant defensivo**
    "RLS ENABLE+FORCE em todas as tabelas tenant-scoped + filtro AND tenant_id = $X explícito em toda query (defesa em profundidade). Mesmo se a RLS falhar por bug de role, o filtro segura."

- **Selos** (badges no rodapé do pilar, substituindo ANVISA/ISO27001 fictícios):
  - `LGPD COMPLIANT`
  - `CFM RES. 2.314/2022`
  - `MULTI-TENANT RLS`
  - `AUDIT TRAIL`
  - `AES-256 IN TRANSIT/REST`

### [10] Impacto (existente, números honestos)

KPIs grandes em grid 4 colunas, mantendo composição visual mas com números honestos:
- `~70%` redução estimada no tempo de leitura de exame complexo
- `5` agentes IA paralelos por exame
- `< 60s` PDF → insight estruturado
- `99%` disponibilidade alvo

Disclaimer logo abaixo: *"Estimativas baseadas em rotinas clínicas típicas; resultados variam por especialidade e volume."*

### [11] Calculadora (existente, fórmula ajustada)

Inputs:
- `Exames por dia` (slider 1–50, default 10)
- `Minutos lidos manualmente por exame` (slider 5–30, default 12)
- `Valor médio da consulta R$` (slider 100–500, default 250)

Output (3 KPIs):
- **Horas economizadas/mês** = `exames × (min_atual − 2) × 22 / 60` (assume revisão pós-IA = 2min)
- **Consultas extras possíveis** = `horas / 0.5` (consulta = 30min)
- **Receita adicional estimada/mês** = `consultas × valor`

Mantém estética atual; só atualiza fórmula e labels. Disclaimer reforçado.

### [12] Preços (existente, mantém)

R$ 199/mês + 4 pacotes (Starter R$49,90 / Pro R$109,90 / Clínica R$199,90 / Enterprise R$379,90) — sem alteração nos números.

**Adiciona** uma linha discreta sob o card de assinatura, em mono 11px text-2:
> "Inclui agenda, copilot por voz, chat entre clínicas, dashboard e compliance — tudo no plano base. Créditos pagam só execução de agentes IA."

### [13] FAQ (atualizada — 8 perguntas)

1. **Os laudos substituem o diagnóstico médico?** *(mantida)*
2. **Quanto tempo leva para começar a usar?** *(reescrita: sem File Drop / HL7 falsos — só "cadastro em 5 min, primeiro exame em 1 min, integração via upload direto")*
3. **Como funciona a cobrança por crédito?** *(mantida, atualizada)*
4. **Os dados dos pacientes são usados para treinamento?** *(mantida — não, contratual e técnico)*
5. **A agenda e o copilot por voz são pagos à parte?** *(NOVA — não, inclusos no plano base)*
6. **O copilot por voz funciona em qualquer navegador?** *(NOVA — Chrome, Edge, Safari mobile; Firefox não tem Web Speech API. Botão fica oculto se não suportado.)*
7. **Como funciona a anonimização de PII em anexos?** *(NOVA — explica pipeline: extração de texto + regex + Haiku + retângulos pretos client-side antes de upload)*
8. **Atendem clínicas veterinárias de pequeno porte?** *(mantida)*

### [14] Footer CTA (existente, copy ajustado)

- Heading: `LIBERE HORAS<br/>DA SUA<br/><span color-cross>ROTINA CLÍNICA.</span>` (substitui "REDUZA TEMPO DE LAUDO 80%")
- Sub: "5 minutos pra começar. Comece pelo módulo do seu jeito de trabalhar."
- CTAs: `Criar conta →` (primary) + ghost `Já sou cliente · Entrar`

### [15] Footer (existente, links ajustados)

- Brand: "© 2026 GenomaFlow · Inteligência Clínica Assistiva" (versão fica como hoje, bump cosmético opcional)
- Links: `LGPD` (ancora `#compliance`), `Compliance` (ancora `#compliance`), `Status`, `Documentação`, `Contato`

## Sistema visual (mantém o atual)

- **Tipografia**: Inter Tight (UI), Fraunces italic (accent emocional), JetBrains Mono (técnico/numérico). Sem mudança de fontes.
- **Paleta**: dark base (`#0a0a0c → #1a1a1f`) + text (`#f5f5f7`) + accent vermelho cross (`#ff3b2f`) + warn/crit/ok semânticos. Sem mudança.
- **Spacing/grid**: mantém 48px gutter, max-width 1440px, breakpoints 640/1024.
- **Animações**: scroll reveal suave (IntersectionObserver), nenhuma animação de entrada bloqueante. Vídeos com `autoplay muted loop playsinline`.
- **Acessibilidade**: navegação por teclado mantida, foco visível, contraste AA mínimo (texto-2 sobre bg-1 já passa).

## Implementação (notas técnicas)

- **Único arquivo:** `apps/landing/index.html` (HTML estático servido pelo nginx do `apps/web`)
- **Sem dependências novas:** mantém apenas Google Fonts + JS inline
- **Toggle persona:**
  - JS function `setPersona(persona)` que adiciona class `persona--human` ou `persona--veterinary` ou `persona--both` no `<body>`
  - CSS condicional via `body.persona--veterinary .module-col-human { opacity: 0.5; }` e mesmo pra inverso
  - Terminologia troca via `data-human` e `data-vet` attributes em spans específicos:
    ```html
    <span data-human="Pacientes" data-vet="Animais">Pacientes</span>
    ```
    JS lê todos os `[data-human][data-vet]` e troca textContent conforme persona.
  - Persistência: `localStorage.getItem('genoma_persona')` no `DOMContentLoaded` chama `setPersona(stored ?? 'both')`.
- **Top bar 1ª visita:**
  - Mostra se `localStorage.getItem('genoma_persona_hint_dismissed') === null`
  - Qualquer click (escolha ou ×) seta a flag.
- **Sincronização com `apps/web/landing/index.html`:** o file dentro de `apps/web/landing/` foi um snapshot pré-split do site. Após split de subdomínios (2026-04-27), só `apps/landing/index.html` é servido em prod (nginx do `apps/web` aponta pra ele). Apaga `apps/web/landing/` na PR pra remover confusão.
- **Vídeos:** `apps/landing/videos/` já contém demo1–4. Pra novos vídeos (Imagens DICOM, Agenda, Voz, Chat clínicas, Dashboard), começar com posters estáticos (PNG) e ir produzindo. Nenhum bloco fica vazio — placeholder visual sempre.
- **Performance:** página deve continuar abaixo de 200KB transferred (sem vídeos preloaded). Vídeos com `preload="none"` exceto F1 que é `preload="auto"` (above the fold).

## Out of scope

- Páginas separadas (sobre, blog, contato)
- Formulário de contato/demo (não pediu)
- Integração com CRM/Hubspot
- Tracking de analytics (GA4, Hotjar)
- Multi-idioma (só pt-BR)
- Versão impressa / PDF da landing
- Mudança de design system (cores, tipografia)
- Substituir vídeos demo (placeholders são aceitáveis)

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Toggle quebra SEO se conteúdo ficar oculto | Usar CSS `opacity` em vez de `display: none` no toggle de módulos. Conteúdo sempre indexável |
| Top bar irrita visitante | Animação slideUp suave + dispensável com 1 click + nunca volta |
| Métricas estimadas viram alvo de questionamento | Disclaimer explícito em toda métrica estimada, copy honesto ("estimado", "típico") |
| Vídeos pesados degradam first paint | `preload="none"` exceto above the fold; lazy-load via IntersectionObserver |
| Page weight cresce demais | Manter HTML único <250KB, vídeos em CDN (S3+CloudFront se preciso) |
| Conteúdo novo (8 features) deixa scroll cansativo | 3 pilares no topo dão índice; sticky nav com âncoras facilita pular |

## Critérios de aceite

1. ✅ Toggle Médico/Vet funciona e persiste em `localStorage`
2. ✅ Top bar aparece só na 1ª visita e some após primeira interação
3. ✅ Todas as 14 features-âncora têm bloco visível na landing
4. ✅ Métricas fictícias removidas; estimativas com disclaimer no lugar
5. ✅ Logos clientes e selos sem certificação removidos
6. ✅ Mobile (320–767px) e tablet (768–1023px) funcionais
7. ✅ Page weight inicial (sem vídeos) < 250KB
8. ✅ Lighthouse score Performance ≥ 85, Accessibility ≥ 95
9. ✅ Anchor links funcionam (hash navigation)
10. ✅ CTAs `data-cta` continuam funcionando com `resolveCtaUrl`

## Próximos passos

1. Esta spec é aprovada pelo usuário
2. Invocar `superpowers:writing-plans` para gerar plano detalhado de implementação (quebra em tarefas, testes, ordem de execução)
3. Executar plano em branch `feat/landing-page-update` com smoke local antes de aprovação humana e merge
