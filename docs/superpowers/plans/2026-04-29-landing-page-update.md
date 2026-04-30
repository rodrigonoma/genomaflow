# Landing Page Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atualizar a landing page (`apps/landing/index.html`) pra refletir a plataforma operacional clínica completa (agenda, copilot por voz, chat entre clínicas, dashboard, prescrições, audit log, anonimização PII), substituindo a narrativa atual de "ferramenta de análise de exames" por "plataforma com IA no centro".

**Architecture:** HTML estático único servido pelo nginx do `apps/web`. Sem framework, sem build, sem deps novas — apenas Google Fonts + JS inline. Mantém design system atual (Inter Tight + Fraunces + JetBrains Mono, dark theme, accent vermelho cross). Adições: top bar de personalização (1ª visita), nav toggle Médico/Vet com persistência via `localStorage`, 3 novas seções estruturais (3 Pilares, Pilar 2 Operação, Pilar 3 Compliance), 5 feature blocks novos, métricas estimadas honestas substituindo fictícias.

**Tech Stack:** HTML5, CSS3 (custom properties, grid, flexbox, `@property`), JS vanilla (sem deps), Google Fonts.

**Spec de referência:** `docs/superpowers/specs/2026-04-29-landing-page-update-design.md`. Seções marcadas `[ref §X]` apontam pro spec pra copy completa.

---

## File Structure

- **Modify:** `apps/landing/index.html` — único arquivo de produção
- **Delete:** `apps/web/landing/` (diretório inteiro) — snapshot pré-split de subdomínios, hoje órfão
- **Branch:** `feat/landing-page-update` (já existe, criada na fase de spec)

Cada task é autônoma (CSS + HTML + JS relacionados, com smoke test no fim). Commits frequentes. Trabalho linear sobre um único arquivo grande, então a granularidade é por **seção visual** e não por tipo (CSS/HTML/JS).

---

## Task 1: Setup + limpar diretório órfão

**Files:**
- Delete: `apps/web/landing/` (diretório inteiro com `index.html`, `logo_genoma.png`, `videos/`)

- [ ] **Step 1: Verificar branch atual**

Run: `git branch --show-current && git status --short | head -5`

Expected: `feat/landing-page-update` (já existe). Status pode ter os arquivos `??` esperados.

- [ ] **Step 2: Confirmar que `apps/web/landing/` é órfão**

Run: `diff apps/landing/index.html apps/web/landing/index.html && grep -r "apps/web/landing" apps/web/nginx.conf docker/ 2>/dev/null`

Expected: Único diff é `APP_BASE` (snapshot pré-split). Nenhuma referência em nginx.conf — confirma órfão.

- [ ] **Step 3: Remover diretório órfão**

Run: `git rm -rf apps/web/landing/`

Expected: 3 arquivos removidos.

- [ ] **Step 4: Verificar que prod ainda aponta pra `apps/landing/`**

Run: `grep -nE "landing|root\s+/" apps/web/nginx.conf | head -10`

Expected: nginx.conf tem `root /usr/share/nginx/html/landing` ou similar; apenas o de `apps/landing/` é copiado em `apps/web/Dockerfile`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(landing): remover diretório órfão apps/web/landing

Snapshot pré-split de subdomínios (2026-04-27). Único conteúdo servido em
prod é apps/landing/index.html via nginx do apps/web.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Top bar de personalização (1ª visita)

**Files:**
- Modify: `apps/landing/index.html` (CSS após `:root`, HTML antes do `<nav>`, JS no script bottom)

- [ ] **Step 1: Adicionar CSS da top bar após o bloco `:root`**

Localizar `apps/landing/index.html:27` (fim do bloco `:root`) e inserir antes da linha `*, *::before...`:

```css
    /* ── PERSONA TOP BAR (1ª visita) ── */
    .persona-bar {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 110;
      height: 36px;
      background: #000;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 24px;
      padding: 0 48px;
      transform: translateY(0);
      transition: transform 0.4s ease, opacity 0.3s ease;
    }
    .persona-bar.is-dismissed {
      transform: translateY(-100%);
      opacity: 0;
      pointer-events: none;
    }
    .persona-bar-text {
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-2);
    }
    .persona-bar-actions {
      display: flex;
      gap: 8px;
    }
    .persona-bar-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 14px;
      background: transparent;
      border: 1px solid var(--line);
      color: var(--text);
      font-family: "Inter Tight", sans-serif;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      cursor: pointer;
      border-radius: 999px;
      transition: background 0.15s, border-color 0.15s;
    }
    .persona-bar-btn:hover {
      background: var(--bg-2);
      border-color: var(--cross);
    }
    .persona-bar-btn svg {
      width: 14px;
      height: 14px;
      stroke: var(--cross);
      fill: none;
      stroke-width: 1.5;
    }
    .persona-bar-close {
      position: absolute;
      right: 16px;
      background: none;
      border: none;
      color: var(--text-3);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 4px 8px;
    }
    .persona-bar-close:hover { color: var(--text); }

    /* nav desce 36px quando persona bar visível */
    body.persona-bar-visible .nav { top: 36px; }
    body.persona-bar-visible .marquee-wrap { margin-top: 100px; }

    @media (max-width: 640px) {
      .persona-bar {
        flex-direction: column;
        height: auto;
        padding: 8px 16px;
        gap: 8px;
      }
      .persona-bar-text { font-size: 9px; }
      .persona-bar-btn { padding: 8px 16px; font-size: 12px; }
      .persona-bar-close { top: 8px; right: 12px; }
      body.persona-bar-visible .nav { top: 88px; }
      body.persona-bar-visible .marquee-wrap { margin-top: 152px; }
    }
```

- [ ] **Step 2: Adicionar HTML da top bar antes do `<nav class="nav">`**

Localizar a tag `<nav class="nav">` (~linha 1591 — `grep -n '<nav class="nav"'`) e inserir antes:

```html
<!-- PERSONA TOP BAR (mostra apenas 1ª visita) -->
<div class="persona-bar" id="personaBar" role="dialog" aria-label="Personalize sua experiência">
  <span class="persona-bar-text">Personalize sua experiência:</span>
  <div class="persona-bar-actions">
    <button class="persona-bar-btn" data-set-persona="human" aria-label="Atendo humanos">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="6" r="3"/>
        <path d="M6 21v-2a6 6 0 0 1 12 0v2"/>
      </svg>
      Atendo humanos
    </button>
    <button class="persona-bar-btn" data-set-persona="veterinary" aria-label="Atendo animais">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="4" r="2"/>
        <circle cx="18" cy="8" r="2"/>
        <circle cx="4" cy="8" r="2"/>
        <circle cx="7.5" cy="14.5" r="3" fill="currentColor" stroke="none"/>
      </svg>
      Atendo animais
    </button>
  </div>
  <button class="persona-bar-close" id="personaBarClose" aria-label="Dispensar">×</button>
</div>
```

- [ ] **Step 3: Adicionar JS de gerenciamento da top bar no final do `<script>` existente**

Localizar `apps/landing/index.html:2380` (início do script com `const APP_BASE`) e ANTES dele inserir as funções; OU adicionar no fim do script existente. Usar este bloco:

```javascript
  // ── PERSONA BAR (1ª visita) ──
  (function initPersonaBar() {
    const PERSONA_KEY = 'genoma_persona';
    const HINT_KEY = 'genoma_persona_hint_dismissed';
    const bar = document.getElementById('personaBar');
    const closeBtn = document.getElementById('personaBarClose');

    if (!bar) return;

    const hintDismissed = localStorage.getItem(HINT_KEY);
    if (hintDismissed) {
      bar.style.display = 'none';
      return;
    }

    document.body.classList.add('persona-bar-visible');

    function dismissBar(persona) {
      if (persona) localStorage.setItem(PERSONA_KEY, persona);
      localStorage.setItem(HINT_KEY, '1');
      bar.classList.add('is-dismissed');
      setTimeout(() => {
        bar.style.display = 'none';
        document.body.classList.remove('persona-bar-visible');
      }, 400);
      if (persona && typeof window.setPersona === 'function') {
        window.setPersona(persona);
      }
    }

    bar.querySelectorAll('[data-set-persona]').forEach(btn => {
      btn.addEventListener('click', () => dismissBar(btn.dataset.setPersona));
    });
    closeBtn.addEventListener('click', () => dismissBar(null));
  })();
```

> Nota: `window.setPersona` será definido na Task 3. Por enquanto a barra só dispara o dismiss; o setPersona ainda não existe e o `if` cobre.

- [ ] **Step 4: Smoke test no browser**

Run: `python3 -m http.server 8000 --directory apps/landing/ &` (ou abrir o arquivo direto)

Em outro terminal: `open http://localhost:8000` (ou navegar manualmente).

Expected:
- Top bar aparece no topo, preta, com texto "PERSONALIZE SUA EXPERIÊNCIA" + 2 botões pill + ×
- Clicar em "Atendo humanos" → barra anima slide-up e some
- F5 → barra não volta (verificar `localStorage.getItem('genoma_persona')` no DevTools)
- Limpar localStorage → F5 → barra volta
- Mobile (DevTools 375px): barra empilha texto + botões verticalmente

Run: `kill %1` (parar python http.server)

- [ ] **Step 5: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): top bar de personalização (1ª visita)

Faixa preta 36px topo com toggle "Atendo humanos | Atendo animais" + ×.
Persiste em localStorage e desaparece pra sempre após qualquer escolha.
Mobile-friendly com layout empilhado <640px.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Nav toggle Médico/Vet + persona machinery

**Files:**
- Modify: `apps/landing/index.html` (CSS pra pill toggle, HTML do nav, JS de persona)

- [ ] **Step 1: Adicionar CSS do pill toggle no nav**

Localizar `apps/landing/index.html:107` (fim do bloco `.btn-primary:hover`) e inserir:

```css
    /* ── NAV PERSONA PILL ── */
    .nav-persona-pill {
      display: inline-flex;
      align-items: center;
      gap: 0;
      padding: 3px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: 999px;
      margin-right: 8px;
    }
    .nav-persona-opt {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      background: transparent;
      border: none;
      color: var(--text-3);
      font-family: "Inter Tight", sans-serif;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      cursor: pointer;
      border-radius: 999px;
      transition: background 0.15s, color 0.15s;
    }
    .nav-persona-opt svg {
      width: 12px;
      height: 12px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
    }
    .nav-persona-opt:hover { color: var(--text-2); }
    .nav-persona-opt.is-active {
      background: var(--cross);
      color: #fff;
    }
    .nav-persona-opt.is-active:hover { color: #fff; }

    @media (max-width: 768px) {
      .nav-persona-pill { display: none; }
      .nav-mobile-persona-pill {
        display: inline-flex;
        margin: 16px;
      }
    }
```

- [ ] **Step 2: Adicionar HTML do pill no nav**

Localizar a estrutura `<div class="nav-cta">` (~linha 1599 — `grep -n 'nav-cta'`). Inserir o pill ANTES dela:

```html
<div class="nav-persona-pill" role="group" aria-label="Selecione seu perfil clínico">
  <button class="nav-persona-opt" data-set-persona="human" aria-label="Médico humano">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="6" r="3"/>
      <path d="M6 21v-2a6 6 0 0 1 12 0v2"/>
    </svg>
    Humano
  </button>
  <button class="nav-persona-opt" data-set-persona="veterinary" aria-label="Veterinário">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="4" r="2"/>
      <circle cx="18" cy="8" r="2"/>
      <circle cx="4" cy="8" r="2"/>
      <circle cx="7.5" cy="14.5" r="3" fill="currentColor" stroke="none"/>
    </svg>
    Vet
  </button>
</div>
```

- [ ] **Step 3: Adicionar persona machinery JS (após o bloco da Task 2)**

Substituir o bloco da Task 2 por (versão completa que inclui setPersona):

```javascript
  // ── PERSONA MACHINERY ──
  const PERSONA_KEY = 'genoma_persona';

  window.setPersona = function setPersona(persona) {
    // persona: 'human' | 'veterinary' | 'both'
    const validPersonas = ['human', 'veterinary', 'both'];
    if (!validPersonas.includes(persona)) persona = 'both';

    localStorage.setItem(PERSONA_KEY, persona);

    // Remove all persona classes from body
    document.body.classList.remove('persona--human', 'persona--veterinary', 'persona--both');
    document.body.classList.add('persona--' + persona);

    // Update active state on nav pill
    document.querySelectorAll('.nav-persona-opt').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.setPersona === persona);
    });

    // Update terminology via data-human/data-vet attributes
    document.querySelectorAll('[data-human][data-vet]').forEach(el => {
      if (persona === 'human') el.textContent = el.dataset.human;
      else if (persona === 'veterinary') el.textContent = el.dataset.vet;
      else el.textContent = el.dataset.human + ' · ' + el.dataset.vet;
    });
  };

  // Bind nav pill clicks
  document.querySelectorAll('.nav-persona-opt').forEach(btn => {
    btn.addEventListener('click', () => window.setPersona(btn.dataset.setPersona));
  });

  // Hydrate from localStorage on load
  const storedPersona = localStorage.getItem(PERSONA_KEY) || 'both';
  window.setPersona(storedPersona);

  // ── PERSONA BAR (1ª visita) ──
  (function initPersonaBar() {
    const HINT_KEY = 'genoma_persona_hint_dismissed';
    const bar = document.getElementById('personaBar');
    const closeBtn = document.getElementById('personaBarClose');

    if (!bar) return;

    const hintDismissed = localStorage.getItem(HINT_KEY);
    if (hintDismissed) {
      bar.style.display = 'none';
      return;
    }

    document.body.classList.add('persona-bar-visible');

    function dismissBar(persona) {
      if (persona) window.setPersona(persona);
      localStorage.setItem(HINT_KEY, '1');
      bar.classList.add('is-dismissed');
      setTimeout(() => {
        bar.style.display = 'none';
        document.body.classList.remove('persona-bar-visible');
      }, 400);
    }

    bar.querySelectorAll('[data-set-persona]').forEach(btn => {
      btn.addEventListener('click', () => dismissBar(btn.dataset.setPersona));
    });
    closeBtn.addEventListener('click', () => dismissBar(null));
  })();
```

- [ ] **Step 4: Smoke test**

Run: `python3 -m http.server 8000 --directory apps/landing/ &`

Open `http://localhost:8000` no browser.

Expected:
- Pill "Humano | Vet" aparece no nav, opção ativa em vermelho cross
- Click "Humano" → fica vermelho; "Vet" fica em texto-3
- F5 → pill mantém escolha (`localStorage.getItem('genoma_persona')` retorna `'human'`)
- DevTools Console: `localStorage.removeItem('genoma_persona')` → F5 → pill mostra ambas as opções inativas (default 'both')
- DevTools < 768px: pill some no nav (será reintroduzido em mobile menu se preciso futuramente)

Run: `kill %1`

- [ ] **Step 5: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): pill toggle Médico/Vet no nav + persona machinery

window.setPersona() troca state em body class + atualiza pill ativo +
substitui terminologia via data-human/data-vet attributes em qualquer
elemento. Persiste em localStorage. Top bar passou a usar o setPersona
unificado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Hero repivotado

**Files:**
- Modify: `apps/landing/index.html` linhas ~1606–1690 (seção hero atual)

- [ ] **Step 1: Localizar e ler o hero atual**

Run: `grep -n '<section class="hero">' apps/landing/index.html`

Anotar linha de início (`<section class="hero">`) e fim (`</section>` correspondente — em torno da linha 1690).

- [ ] **Step 2: Substituir conteúdo do hero-left**

Localizar bloco `<div class="hero-left">` e seu conteúdo até o `</div>` correspondente. Substituir por:

```html
  <div class="hero-left">
    <div class="hero-tag">Plataforma clínica com IA no centro</div>
    <div class="hero-display">
      <span class="display-word">A clínica</span>
      <span class="display-arrow">↘</span>
      <span class="display-word">que pensa</span>
      <span class="display-num" style="font-family:'Fraunces',serif;font-style:italic;font-weight:600;letter-spacing:-0.04em">com você.</span>
    </div>
    <p class="hero-sub">
      Da agenda à análise de exames, do laudo à prescrição, <em class="hero-italic">uma só plataforma</em>. Inteligência artificial assistiva pra suas decisões clínicas — auditável, multi-tenant e em conformidade com a LGPD.
      <br/><em class="hero-italic">Para humanos e animais.</em>
    </p>
    <div class="hero-actions">
      <a class="btn-primary" data-cta="/onboarding">Criar conta gratuita →</a>
      <a class="hero-link-ghost" data-cta="/login">Já sou cliente · Entrar</a>
    </div>
    <div class="hero-actions" style="margin-top:-32px;margin-bottom:48px">
      <a class="hero-link-ghost" href="#operacao">Ver a plataforma em ação ↓</a>
    </div>
    <div class="hero-metrics">
      <div>
        <span class="hero-metric-val">~6–13min</span>
        <span class="hero-metric-label">poupados por exame</span>
      </div>
      <div>
        <span class="hero-metric-val">5 agentes</span>
        <span class="hero-metric-label">IA por exame</span>
      </div>
      <div>
        <span class="hero-metric-val">&lt; 60s</span>
        <span class="hero-metric-label">PDF → insight</span>
      </div>
      <div>
        <span class="hero-metric-val">99%</span>
        <span class="hero-metric-label">uptime alvo</span>
      </div>
    </div>
    <p style="font-size:11px;color:var(--text-3);margin-top:18px;line-height:1.5;font-family:'JetBrains Mono',monospace;letter-spacing:0.03em">
      Estimativas baseadas em rotinas clínicas típicas; resultados variam por especialidade e volume.
    </p>
  </div>
```

- [ ] **Step 3: Smoke test**

Run: `python3 -m http.server 8000 --directory apps/landing/ &` e abrir browser.

Expected:
- Hero mostra "A clínica ↘ que pensa com você" — última linha em Fraunces italic vermelho
- Subtítulo menciona "agenda", "análise", "laudo", "prescrição"
- 4 métricas honestas (sem 847k, 312, 99.94%)
- Disclaimer 11px abaixo das métricas
- 2 CTAs: "Criar conta gratuita" + "Já sou cliente · Entrar" + texto "Ver a plataforma em ação ↓"
- Mobile: tudo empilhado, sem scroll horizontal

Run: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): repivotar hero pra plataforma operacional clínica

Título "A clínica que pensa com você" (Fraunces italic vermelho na última
linha), subtítulo cobrindo agenda/análise/laudo/prescrição, 4 métricas
honestas com disclaimer (~6-13min/exame, 5 agentes IA, <60s, 99% uptime),
âncora "Ver a plataforma em ação" pra #operacao.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Atualizar Marquee + criar seção 3 Pilares (substitui logos fictícios)

**Files:**
- Modify: `apps/landing/index.html` — marquee items (~linha 1693), substituir bloco `.logos` (~linha 1697–1706) pela seção 3 Pilares

- [ ] **Step 1: Atualizar items do marquee**

Localizar `<div class="marquee-track">` (~linha 1693). Substituir conteúdo dos `marquee-item` por:

```html
<div class="marquee-track">
  <span class="marquee-item">ANÁLISE MULTI-AGENTE</span><span class="marquee-sep">·</span>
  <span class="marquee-item">IMAGEM DICOM</span><span class="marquee-sep">·</span>
  <span class="marquee-item">CHATBOT RAG</span><span class="marquee-sep">·</span>
  <span class="marquee-item">COMPARAÇÃO LONGITUDINAL</span><span class="marquee-sep">·</span>
  <span class="marquee-item">AGENDA NATIVA</span><span class="marquee-sep">·</span>
  <span class="marquee-item">COPILOT POR VOZ</span><span class="marquee-sep">·</span>
  <span class="marquee-item">PRESCRIÇÕES</span><span class="marquee-sep">·</span>
  <span class="marquee-item">CHAT ENTRE CLÍNICAS</span><span class="marquee-sep">·</span>
  <span class="marquee-item">DASHBOARD</span><span class="marquee-sep">·</span>
  <span class="marquee-item">ANONIMIZAÇÃO PII</span><span class="marquee-sep">·</span>
  <span class="marquee-item">AUDIT LOG</span><span class="marquee-sep">·</span>
  <span class="marquee-item">LGPD-FIRST</span><span class="marquee-sep">·</span>
  <!-- duplicar o conteúdo pra loop seamless -->
  <span class="marquee-item">ANÁLISE MULTI-AGENTE</span><span class="marquee-sep">·</span>
  <span class="marquee-item">IMAGEM DICOM</span><span class="marquee-sep">·</span>
  <span class="marquee-item">CHATBOT RAG</span><span class="marquee-sep">·</span>
  <span class="marquee-item">COMPARAÇÃO LONGITUDINAL</span><span class="marquee-sep">·</span>
  <span class="marquee-item">AGENDA NATIVA</span><span class="marquee-sep">·</span>
  <span class="marquee-item">COPILOT POR VOZ</span><span class="marquee-sep">·</span>
  <span class="marquee-item">PRESCRIÇÕES</span><span class="marquee-sep">·</span>
  <span class="marquee-item">CHAT ENTRE CLÍNICAS</span><span class="marquee-sep">·</span>
  <span class="marquee-item">DASHBOARD</span><span class="marquee-sep">·</span>
  <span class="marquee-item">ANONIMIZAÇÃO PII</span><span class="marquee-sep">·</span>
  <span class="marquee-item">AUDIT LOG</span><span class="marquee-sep">·</span>
  <span class="marquee-item">LGPD-FIRST</span><span class="marquee-sep">·</span>
</div>
```

- [ ] **Step 2: Adicionar CSS pra seção 3 Pilares (após CSS do `.logo-item`, ~linha 873)**

Inserir antes do `/* ── FEATURE BLOCKS ── */`:

```css
    /* ── 3 PILARES ── */
    .pillars-section {
      padding: 80px 48px;
      border-bottom: 1px solid var(--line);
    }
    .pillars-header {
      margin-bottom: 56px;
    }
    .pillars-heading {
      font-size: clamp(40px, 5vw, 64px);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1;
    }
    .pillars-heading em {
      font-family: "Fraunces", serif;
      font-style: italic;
      font-weight: 600;
      color: var(--cross);
    }
    .pillars-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
    }
    .pillar-card {
      position: relative;
      padding: 32px 28px;
      background: var(--bg-1);
      border: 1px solid var(--line);
      border-left: 2px solid var(--cross);
      transition: transform 0.2s, border-color 0.2s;
    }
    .pillar-card:hover {
      transform: translateY(-4px);
      border-color: var(--cross);
    }
    .pillar-icon {
      width: 32px;
      height: 32px;
      stroke: var(--cross);
      fill: none;
      stroke-width: 1.5;
      margin-bottom: 20px;
    }
    .pillar-tag {
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--text-3);
      margin-bottom: 8px;
    }
    .pillar-heading {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
      margin-bottom: 16px;
      color: var(--text);
    }
    .pillar-heading strong {
      font-family: "Fraunces", serif;
      font-style: italic;
      font-weight: 600;
      color: var(--cross);
    }
    .pillar-sub {
      font-size: 13px;
      color: var(--text-2);
      line-height: 1.6;
      margin-bottom: 18px;
    }
    .pillar-bullets {
      list-style: none;
      padding: 0;
      margin: 0 0 20px;
    }
    .pillar-bullets li {
      font-size: 12px;
      color: var(--text-3);
      padding: 5px 0;
      border-bottom: 1px dashed var(--line-soft);
    }
    .pillar-bullets li:last-child { border-bottom: none; }
    .pillar-cta {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--cross);
      border-bottom: 1px solid var(--cross);
      padding-bottom: 2px;
      transition: color 0.15s, border-color 0.15s;
    }
    .pillar-cta:hover { color: var(--text); border-color: var(--text); }

    @media (max-width: 1024px) {
      .pillars-grid { grid-template-columns: 1fr; gap: 16px; }
    }
```

- [ ] **Step 3: Substituir bloco `.logos` por seção 3 Pilares**

Localizar `<div class="logos">` (~linha 1697) e seu fechamento `</div>` (~linha 1706). Substituir o bloco INTEIRO por:

```html
<!-- 3 PILARES -->
<section id="pilares" class="pillars-section">
  <div class="pillars-header">
    <div class="section-label">Plataforma completa</div>
    <h2 class="pillars-heading">Três pilares.<br/><em>Uma só plataforma.</em></h2>
  </div>
  <div class="pillars-grid">
    <article class="pillar-card">
      <svg class="pillar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 17l4-4 4 4 6-6 4 4"/>
        <circle cx="7" cy="13" r="1.5"/>
        <circle cx="11" cy="17" r="1.5"/>
        <circle cx="17" cy="11" r="1.5"/>
      </svg>
      <div class="pillar-tag">Pilar 01 · IA Clínica</div>
      <h3 class="pillar-heading">Inteligência que <strong>lê e correlaciona</strong></h3>
      <p class="pillar-sub">Análise multi-agente em tempo real, com fontes citadas e confiança auditável.</p>
      <ul class="pillar-bullets">
        <li>Multi-agentes paralelos</li>
        <li>Imagens DICOM/RX/ECG</li>
        <li>Chatbot RAG por paciente</li>
        <li>Comparação longitudinal</li>
      </ul>
      <a class="pillar-cta" href="#ia">Ver IA Clínica ↓</a>
    </article>

    <article class="pillar-card">
      <svg class="pillar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="8" y1="3" x2="8" y2="7"/>
        <line x1="16" y1="3" x2="16" y2="7"/>
        <path d="M9 15l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="pillar-tag">Pilar 02 · Operação</div>
      <h3 class="pillar-heading">A clínica que <strong>se organiza sozinha</strong></h3>
      <p class="pillar-sub">Agenda, prescrições, comunicação entre clínicas e dashboard — tudo conversa entre si.</p>
      <ul class="pillar-bullets">
        <li>Agenda com voz</li>
        <li>Prescrições com templates</li>
        <li>Chat entre clínicas</li>
        <li>Dashboard clínico</li>
      </ul>
      <a class="pillar-cta" href="#operacao">Ver Operação ↓</a>
    </article>

    <article class="pillar-card">
      <svg class="pillar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l8 4v6c0 5-3.5 8.5-8 9-4.5-0.5-8-4-8-9V7z"/>
        <rect x="9" y="11" width="6" height="6" rx="1"/>
        <path d="M11 11V9a1 1 0 0 1 2 0v2"/>
      </svg>
      <div class="pillar-tag">Pilar 03 · Compliance</div>
      <h3 class="pillar-heading"><strong>LGPD pensada</strong> desde o primeiro byte</h3>
      <p class="pillar-sub">Anonimização automática de PII, audit log forense, consentimento e onboarding profissional verificado.</p>
      <ul class="pillar-bullets">
        <li>Anonimização automática</li>
        <li>Audit log forense</li>
        <li>Consentimento LGPD</li>
        <li>CRM/CRMV verificado</li>
      </ul>
      <a class="pillar-cta" href="#compliance">Ver Compliance ↓</a>
    </article>
  </div>
</section>
```

- [ ] **Step 4: Adicionar PILARES ao nav-links**

Localizar `<ul class="nav-links">` (~linha 1593). Garantir que tem entrada `<li><a href="#pilares">PILARES</a></li>` entre MÓDULOS e PRODUTO. Conteúdo final do nav-links:

```html
<ul class="nav-links">
  <li><a href="#modulos">MÓDULOS</a></li>
  <li><a href="#pilares">PILARES</a></li>
  <li><a href="#produto">PRODUTO</a></li>
  <li><a href="#operacao">OPERAÇÃO</a></li>
  <li><a href="#compliance">COMPLIANCE</a></li>
  <li><a href="#precos">PREÇOS</a></li>
  <li><a href="#faq">FAQ</a></li>
</ul>
```

- [ ] **Step 5: Smoke test**

Run: `python3 -m http.server 8000 --directory apps/landing/ &` e browser.

Expected:
- Marquee tem 12 capabilities reais (não os fictícios antigos), sem flickering no loop
- Onde estavam os logos REDE UNIÃO/SÍRIO: agora mostra "Três pilares. Uma só plataforma." + 3 cards
- Cards têm ícone SVG vermelho, hover sobe 4px com border vermelho
- Click "Ver IA Clínica ↓" rola pra `#ia` (vai criar essa âncora na Task 7)
- Mobile: cards empilham 1 coluna
- Nav atualizado com 7 links

Run: `kill %1`

- [ ] **Step 6: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): atualizar marquee + adicionar seção 3 Pilares

Marquee agora rola 12 capabilities reais (análise IA, agenda, voz, chat, etc)
em vez de strings genéricas. Bloco de logos fictícios (REDE UNIÃO, SÍRIO etc)
substituído por seção "Três pilares. Uma só plataforma." com 3 cards (IA
Clínica / Operação / Compliance) com ícones SVG inline e ancoras pras seções
correspondentes. Nav ganhou links #pilares, #operacao, #compliance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Atualizar módulos Human × Vet com códigos reais + reagir ao toggle

**Files:**
- Modify: `apps/landing/index.html` — bloco `<section id="modulos" class="split">` (~linha 1708–1779)

- [ ] **Step 1: Adicionar CSS pra reação ao toggle no split**

Localizar fim do bloco `.module-desc` (~linha 364). Adicionar:

```css
    /* Persona toggle reactivity */
    body.persona--human #modulos .split-col:nth-child(2) { opacity: 0.5; }
    body.persona--human #modulos .split-col:nth-child(1) {
      border-color: var(--cross);
    }
    body.persona--veterinary #modulos .split-col:nth-child(1) { opacity: 0.5; }
    body.persona--veterinary #modulos .split-col:nth-child(2) {
      border-color: var(--cross);
    }
    body.persona--both #modulos .split-col { opacity: 1; }
    #modulos .split-col {
      transition: opacity 0.3s, border-color 0.3s;
    }
```

- [ ] **Step 2: Substituir conteúdo da coluna Humano**

Localizar `<div class="split-col">` que contém "HUMANO" (~linha 1709). Substituir o `<div class="module-list">` interno por:

```html
<div class="module-list" style="display:grid;grid-template-columns:1fr 1fr;gap:0">
  <div class="module-card">
    <span class="module-code">METAB-1</span>
    <div>
      <div class="module-name">Vias Metabólicas</div>
      <div class="module-desc">Glicemia, lipídios, função hepática e renal.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">CARDIO-1</span>
    <div>
      <div class="module-name">Risco Cardiovascular</div>
      <div class="module-desc">Perfil lipídico + correlações longitudinais.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">HEMA-1</span>
    <div>
      <div class="module-name">Hematologia</div>
      <div class="module-desc">Hemograma, coagulograma e marcadores inflamatórios.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">THERAP-1</span>
    <div>
      <div class="module-name">Terapêutica</div>
      <div class="module-desc">Sugestão de conduta com base em diretrizes.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">NUTRI-1</span>
    <div>
      <div class="module-name">Nutrição clínica</div>
      <div class="module-desc">Plano nutricional ajustado ao perfil clínico.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">CORREL-1</span>
    <div>
      <div class="module-name">Correlação Multi-marcador</div>
      <div class="module-desc">Detecta relações ocultas entre marcadores.</div>
    </div>
  </div>
  <div class="module-card" style="grid-column:span 2">
    <span class="module-code">IMG-1</span>
    <div>
      <div class="module-name">Imagens médicas</div>
      <div class="module-desc">RX, ECG, ultrassom, ressonância e DICOM com bounding boxes.</div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Substituir conteúdo da coluna Veterinário**

Localizar a 2ª `<div class="split-col">` (que contém "VETERINÁRIO"). Substituir o `<div class="module-list">` por:

```html
<div class="module-list" style="display:grid;grid-template-columns:1fr 1fr;gap:0">
  <div class="module-card">
    <span class="module-code">SMALL-1</span>
    <div>
      <div class="module-name">Pequenos animais</div>
      <div class="module-desc">Canídeos e felinos — perfil clínico por porte.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">EQUUS-1</span>
    <div>
      <div class="module-name">Equinos</div>
      <div class="module-desc">Performance, ortopedia e marcadores de esforço.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">BOVINE-1</span>
    <div>
      <div class="module-name">Bovinos</div>
      <div class="module-desc">Saúde do rebanho, reprodução e nutrição.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">THERAP-1</span>
    <div>
      <div class="module-name">Terapêutica veterinária</div>
      <div class="module-desc">Conduta por espécie, peso e contexto clínico.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">NUTRI-1</span>
    <div>
      <div class="module-name">Nutrição animal</div>
      <div class="module-desc">Plano por espécie, peso e fase de vida.</div>
    </div>
  </div>
  <div class="module-card">
    <span class="module-code">IMG-1</span>
    <div>
      <div class="module-name">Imagens veterinárias</div>
      <div class="module-desc">RX, US, ECG e modalidades adaptadas por espécie.</div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Smoke test**

Browser. Click pill "Humano" no nav: coluna VET fica esmaecida. Click "Vet": coluna HUMANO fica esmaecida. Refresh: persiste. Verificar mobile.

Run: `kill %1`

- [ ] **Step 5: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): módulos Human×Vet com códigos reais + reagir ao toggle

Substitui módulos fictícios (CARDIO-3, ONCO-4, CANIS-2, FELIS-3, EXOTIC-1)
por agentes reais do worker (METAB-1, CARDIO-1, HEMA-1, THERAP-1, NUTRI-1,
CORREL-1, IMG-1, SMALL-1, EQUUS-1, BOVINE-1). Cards em grid 2x2 dentro de
cada coluna. Toggle persona esmaece a coluna oposta.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pilar 1 — IA Clínica (atualizar copy + adicionar F3 Imagens)

**Files:**
- Modify: `apps/landing/index.html` — bloco `<section id="diferenciais">` (~linha 1898–2131)

- [ ] **Step 1: Renomear `id="diferenciais"` → `id="ia"` + atualizar header**

Localizar `<section id="diferenciais">` (~linha 1898). Mudar pra `<section id="ia">`. Localizar o header `feat-intro` interno e substituir por:

```html
<div class="feat-intro">
  <div class="feat-intro-sub">01 — IA Clínica</div>
  <h2 class="feat-intro-heading">Cinco agentes. Um exame.<br/><em style="font-family:'Fraunces',serif;font-style:italic;font-weight:600;color:var(--cross)">Um insight auditável.</em></h2>
</div>
```

- [ ] **Step 2: Inserir novo bloco F3 Imagens DICOM entre F2 e o atual F3**

Localizar `<!-- ── F3: Chatbot RAG ── -->` (~linha 2029). Inserir ANTES desse comentário:

```html
  <!-- ── F3 NOVO: Imagens DICOM ── -->
  <div class="feat-block feat-block--rev" id="feat-imaging">
    <div class="feat-video-col">
      <div class="monitor-outer">
        <div class="monitor-frame">
          <div class="monitor-bezel">
            <div class="monitor-screen" style="position:relative;background:#0a0a0e">
              <!-- placeholder visual: bounding boxes simulados sobre imagem cinza -->
              <div style="position:absolute;inset:12%;background:linear-gradient(135deg,#1a1a22,#0e0e13);border-radius:4px"></div>
              <div style="position:absolute;left:30%;top:32%;width:18%;height:14%;border:2px solid var(--cross);border-radius:2px;animation:pulse 2.4s ease-in-out infinite"></div>
              <div style="position:absolute;left:55%;top:48%;width:14%;height:10%;border:2px solid var(--ok);border-radius:2px;animation:pulse 2.4s ease-in-out infinite 0.8s"></div>
              <div style="position:absolute;left:8%;top:8%;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text-3);letter-spacing:0.1em">DICOM · CR · CHEST PA</div>
              <div style="position:absolute;right:8%;bottom:8%;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--cross)">▣ 2 ACHADOS</div>
            </div>
          </div>
          <div class="monitor-neck"></div>
          <div class="monitor-foot"></div>
        </div>
      </div>
    </div>
    <div class="feat-text-col">
      <div class="feat-num">03</div>
      <div class="feat-tag">Pipeline DICOM</div>
      <h3 class="feat-heading">RX, ECG, ultrassom, ressonância.<br/><span class="feat-highlight">A IA também olha.</span></h3>
      <p class="feat-body">Faça upload de DICOM, JPG ou PNG. A IA classifica a modalidade automaticamente, encaminha pro agente especializado e retorna o achado com <strong>bounding boxes</strong> sobre a imagem original. Suporte a RX, ECG, ultrassonografia e ressonância magnética.</p>
      <div class="feat-stats">
        <div>
          <span class="feat-stat-val">4</span>
          <span class="feat-stat-label">modalidades</span>
        </div>
        <div>
          <span class="feat-stat-val">DICOM</span>
          <span class="feat-stat-label">+ JPG/PNG</span>
        </div>
        <div>
          <span class="feat-stat-val">▣</span>
          <span class="feat-stat-label">bounding boxes interativos</span>
        </div>
      </div>
      <div class="feat-disclaimer">
        <div class="feat-disclaimer-icon">⚕</div>
        <p>Vision classifier identifica a modalidade · Agente especializado por modalidade · Disclaimer assistivo em todo achado · Imagem original sempre preservada</p>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: Atualizar numeração dos blocos seguintes**

O F3 antigo (Chatbot RAG) vira F4. F4 antigo (comparação) vira F5. Localizar:
- `<div class="feat-num">03</div>` no bloco do Chatbot RAG → mudar pra `04`
- `<div class="feat-num">04</div>` no bloco da Comparação → mudar pra `05`

- [ ] **Step 4: Refinar copy do F1 (análise multi-agente)**

Localizar `<!-- ── F1: Análise de exame por IA ── -->` e o `<p class="feat-body">` interno. Garantir que termina com referência a "fontes citadas, confiança calibrada e disclaimer LGPD". Edit cirúrgico:

Localizar a `feat-body` do F1 e ao final adicionar `<strong>Cada inferência expõe fonte, confiança e cadeia de raciocínio.</strong>` se ainda não houver menção.

- [ ] **Step 5: Smoke test**

Browser. Confirmar:
- Header "01 — IA Clínica · Cinco agentes. Um exame. Um insight auditável."
- Blocos numerados 01, 02, 03 (Imagens NOVO), 04 (Chatbot RAG), 05 (Comparação)
- Bloco Imagens tem placeholder visual com 2 bounding boxes pulsando (vermelho + verde)
- Anchor `#ia` funciona vindo do botão do pilar 1
- Mobile: blocos empilham vertical, monitor reduz proporcional

Run: `kill %1`

- [ ] **Step 6: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): renomear seção pra IA Clínica + adicionar F3 Imagens DICOM

Section id 'diferenciais' → 'ia'. Header '01 — IA Clínica · Cinco agentes.
Um exame. Um insight auditável.'. Bloco novo F3 'RX, ECG, ultrassom,
ressonância — A IA também olha.' com placeholder visual de bounding
boxes sobre imagem médica. Numeração realocada (Chatbot RAG vira 04,
Comparação vira 05).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Pilar 2 — Operação da clínica (BLOCO TODO NOVO)

**Files:**
- Modify: `apps/landing/index.html` — inserir nova seção `<section id="operacao">` ANTES da seção `<section id="impacto">` (~linha 2134)

- [ ] **Step 1: Adicionar CSS pra blocos com mock visual**

Localizar fim do bloco `.feat-economy-label` (~linha 1100) e inserir:

```css
    /* Operação — mocks de produto */
    .op-mock {
      width: 100%;
      height: 100%;
      min-height: 320px;
      background: linear-gradient(135deg, #0e0e13 0%, #131318 100%);
      border-radius: 4px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: "Inter Tight", sans-serif;
    }
    .op-mock-week {
      display: grid;
      grid-template-columns: 60px repeat(7, 1fr);
      gap: 1px;
      background: var(--line);
      border: 1px solid var(--line);
      border-radius: 3px;
      overflow: hidden;
      flex: 1;
    }
    .op-mock-cell {
      background: #0a0a0e;
      padding: 4px 6px;
      font-family: "JetBrains Mono", monospace;
      font-size: 9px;
      color: var(--text-3);
      min-height: 28px;
    }
    .op-mock-cell.is-event {
      background: rgba(255,59,47,0.18);
      color: var(--text);
      border-left: 2px solid var(--cross);
    }
    .op-mock-cell.is-event-ok {
      background: rgba(74,214,160,0.12);
      color: var(--text);
      border-left: 2px solid var(--ok);
    }
    .op-mock-mic {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      flex: 1;
    }
    .op-mock-mic-btn {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--cross);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 0 rgba(255,59,47,0.4);
      animation: pulse-mic 1.8s ease-in-out infinite;
    }
    @keyframes pulse-mic {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,47,0.5); }
      50% { box-shadow: 0 0 0 24px rgba(255,59,47,0); }
    }
    .op-mock-mic-icon {
      width: 28px;
      height: 28px;
      stroke: #fff;
      fill: none;
      stroke-width: 2;
    }
    .op-mock-transcript {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: var(--text-2);
      text-align: center;
      max-width: 280px;
      line-height: 1.5;
    }
    .op-mock-transcript strong { color: var(--cross); }
    .op-mock-dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      flex: 1;
    }
    .op-mock-kpi {
      background: #0a0a0e;
      border: 1px solid var(--line);
      padding: 14px;
      border-radius: 3px;
    }
    .op-mock-kpi-val {
      font-family: "Fraunces", serif;
      font-size: 28px;
      font-weight: 600;
      color: var(--cross);
      line-height: 1;
    }
    .op-mock-kpi-label {
      font-size: 10px;
      color: var(--text-3);
      margin-top: 6px;
      letter-spacing: 0.05em;
    }
    .op-mock-chat {
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      padding: 8px;
    }
    .op-mock-msg {
      background: #16161b;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
      max-width: 75%;
    }
    .op-mock-msg.is-mine {
      align-self: flex-end;
      background: rgba(255,59,47,0.12);
      border-color: rgba(255,59,47,0.3);
    }
    .op-mock-msg.has-attachment {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .op-mock-attachment {
      width: 36px;
      height: 48px;
      background: #1a1a20;
      border: 1px solid var(--line);
      border-radius: 2px;
      position: relative;
      flex-shrink: 0;
    }
    .op-mock-attachment::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 8px;
      right: 4px;
      height: 4px;
      background: #000;
    }
    .op-mock-attachment::before {
      content: '';
      position: absolute;
      left: 4px;
      top: 18px;
      right: 8px;
      height: 4px;
      background: #000;
    }
```

- [ ] **Step 2: Inserir nova seção `<section id="operacao">` antes de `<section id="impacto">`**

Localizar `<!-- IMPACT -->` (~linha 2133) e inserir ANTES dele:

```html
<!-- ════════════════════════════════════════════ -->
<!-- PILAR 2: OPERAÇÃO DA CLÍNICA                  -->
<!-- ════════════════════════════════════════════ -->
<section id="operacao">
  <div class="feat-intro" style="background:var(--bg-1)">
    <div class="feat-intro-sub">02 — Operação</div>
    <h2 class="feat-intro-heading">A plataforma <em style="font-family:'Fraunces',serif;font-style:italic;font-weight:600;color:var(--cross)">vai além</em><br/>da análise clínica.</h2>
  </div>

  <!-- O1. Agenda -->
  <div class="feat-block" id="feat-agenda">
    <div class="feat-video-col">
      <div class="monitor-outer">
        <div class="monitor-frame">
          <div class="monitor-bezel">
            <div class="monitor-screen">
              <div class="op-mock">
                <div style="display:flex;justify-content:space-between;align-items:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-3);letter-spacing:0.1em">
                  <span>SEMANA · 29/04 → 05/05</span>
                  <span style="color:var(--cross)">● 14 CONSULTAS</span>
                </div>
                <div class="op-mock-week">
                  <div class="op-mock-cell">08h</div>
                  <div class="op-mock-cell">SEG</div>
                  <div class="op-mock-cell">TER</div>
                  <div class="op-mock-cell is-event">Mariana</div>
                  <div class="op-mock-cell">QUI</div>
                  <div class="op-mock-cell is-event-ok">João</div>
                  <div class="op-mock-cell">SAB</div>
                  <div class="op-mock-cell">DOM</div>

                  <div class="op-mock-cell">09h</div>
                  <div class="op-mock-cell is-event">Carlos</div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell is-event-ok">Lúcia</div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>

                  <div class="op-mock-cell">10h</div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell is-event">Pedro</div>
                  <div class="op-mock-cell is-event-ok">Sofia</div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>

                  <div class="op-mock-cell">11h</div>
                  <div class="op-mock-cell is-event-ok">Renato</div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell is-event">Bia</div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                  <div class="op-mock-cell"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="monitor-neck"></div>
          <div class="monitor-foot"></div>
        </div>
      </div>
    </div>
    <div class="feat-text-col">
      <div class="feat-num">01</div>
      <div class="feat-tag">Agenda nativa</div>
      <h3 class="feat-heading">A semana inteira em<br/><span class="feat-highlight">uma tela só.</span></h3>
      <p class="feat-body">Visualização semanal 7×15h, blocos por status (agendado, confirmado, concluído), drag-to-reschedule e detecção de conflito direto no banco. Consulta dura o que era pra durar mesmo se você mudar a configuração depois — princípio de imutabilidade do passado.</p>
      <div class="feat-stats">
        <div>
          <span class="feat-stat-val">7×15h</span>
          <span class="feat-stat-label">grade semanal</span>
        </div>
        <div>
          <span class="feat-stat-val">7</span>
          <span class="feat-stat-label">durações: 30–120min</span>
        </div>
        <div>
          <span class="feat-stat-val">Drag</span>
          <span class="feat-stat-label">to reschedule</span>
        </div>
      </div>
      <div class="feat-disclaimer">
        <div class="feat-disclaimer-icon">📅</div>
        <p>Mobile-first com swipe entre dias · Bloqueios por horário · Free slots em tempo real · Conflito detectado direto no banco</p>
      </div>
    </div>
  </div>

  <!-- O2. Copilot por VOZ ★ -->
  <div class="feat-block feat-block--rev" id="feat-voice">
    <div class="feat-video-col">
      <div class="monitor-outer">
        <div class="monitor-frame">
          <div class="monitor-bezel">
            <div class="monitor-screen">
              <div class="op-mock">
                <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-3);letter-spacing:0.1em;text-align:center">COPILOT · pt-BR · BETA</div>
                <div class="op-mock-mic">
                  <div class="op-mock-mic-btn">
                    <svg class="op-mock-mic-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="12" rx="3"/>
                      <path d="M5 11a7 7 0 0 0 14 0"/>
                      <line x1="12" y1="18" x2="12" y2="22"/>
                    </svg>
                  </div>
                  <div class="op-mock-transcript">
                    "Marca <strong>consulta</strong> para o João Silva <strong>amanhã às 14h</strong>, 60 minutos."
                  </div>
                  <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ok);letter-spacing:0.1em">▶ EXECUTANDO · 3/3 OK</div>
                </div>
              </div>
            </div>
          </div>
          <div class="monitor-neck"></div>
          <div class="monitor-foot"></div>
        </div>
      </div>
    </div>
    <div class="feat-text-col">
      <div class="feat-num">02</div>
      <div class="feat-tag">Copilot por voz · Beta</div>
      <h3 class="feat-heading">Diga. Ele agenda.<br/><span class="feat-highlight">Diga. Ele cancela.</span></h3>
      <p class="feat-body">Pressione o microfone e fale: <em>"marca consulta para o João Silva amanhã às 14h, 60 minutos"</em>. O Copilot resolve o paciente, checa conflito, cria a consulta — e te pede confirmação antes de cancelar qualquer coisa. Áudio nunca sai do navegador.</p>
      <div class="feat-stats">
        <div>
          <span class="feat-stat-val">5</span>
          <span class="feat-stat-label">ações server-side</span>
        </div>
        <div>
          <span class="feat-stat-val">pt-BR</span>
          <span class="feat-stat-label">Web Speech API</span>
        </div>
        <div>
          <span class="feat-stat-val">0%</span>
          <span class="feat-stat-label">áudio sai do browser</span>
        </div>
      </div>
      <div class="feat-disclaimer">
        <div class="feat-disclaimer-icon">🎙</div>
        <p>Confirmação obrigatória pra cancelar · Defesa anti-prompt-injection · Audit log completo · Tools de servidor não aceitam tenant_id do LLM</p>
      </div>
    </div>
  </div>

  <!-- O3. Prescrições -->
  <div class="feat-block" id="feat-rx">
    <div class="feat-video-col">
      <div class="monitor-outer">
        <div class="monitor-frame">
          <div class="monitor-bezel">
            <div class="monitor-screen">
              <div class="op-mock">
                <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-3);letter-spacing:0.1em">
                  <span>RECEITUÁRIO · PR-A8F2C1</span>
                  <span style="color:var(--cross)">● TEMPLATE: PADRÃO</span>
                </div>
                <div style="background:#0a0a0e;border:1px solid var(--line);border-radius:3px;padding:18px;flex:1;display:flex;flex-direction:column;gap:10px">
                  <div style="font-family:'Fraunces',serif;font-style:italic;font-size:14px;color:var(--text)">Paciente: Maria S. · 47 anos</div>
                  <div style="border-top:1px dashed var(--line);padding-top:10px;display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--text-2)">
                    <div>1. <strong style="color:var(--text)">Rosuvastatina 10mg</strong> — 1cp/dia, à noite, por 90 dias</div>
                    <div>2. <strong style="color:var(--text)">Ácido fólico 5mg</strong> — 1cp/dia, jejum, por 30 dias</div>
                    <div>3. <strong style="color:var(--text)">Metformina 500mg</strong> — 1cp 2x/dia, refeições</div>
                  </div>
                  <div style="margin-top:auto;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--text-3);letter-spacing:0.1em;display:flex;justify-content:space-between">
                    <span>SUGERIDO POR THERAP-1</span>
                    <span style="color:var(--cross)">REVISADO PELO MÉDICO ✓</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="monitor-neck"></div>
          <div class="monitor-foot"></div>
        </div>
      </div>
    </div>
    <div class="feat-text-col">
      <div class="feat-num">03</div>
      <div class="feat-tag">Prescrições</div>
      <h3 class="feat-heading">A IA propõe.<br/>Você ajusta.<br/><span class="feat-highlight">O PDF sai pronto.</span></h3>
      <p class="feat-body">Agentes terapêutico e nutricional sugerem prescrição com base no exame. Você revisa, ajusta, salva como template da sua clínica. PDF gerado client-side com identidade visual. Cada prescrição tem chip <strong>PR-xxxxxx</strong> rastreável.</p>
      <div class="feat-disclaimer">
        <div class="feat-disclaimer-icon">⚕</div>
        <p>Templates por clínica · Salvar/aplicar/deletar · PDF jsPDF cliente · Disclaimer assistivo · Médico responsável sempre revisa</p>
      </div>
    </div>
  </div>

  <!-- O4. Chat entre clínicas -->
  <div class="feat-block feat-block--rev" id="feat-clinic-chat">
    <div class="feat-video-col">
      <div class="monitor-outer">
        <div class="monitor-frame">
          <div class="monitor-bezel">
            <div class="monitor-screen">
              <div class="op-mock">
                <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-3);letter-spacing:0.1em">
                  <span>CLÍNICA SÃO RAFAEL ↔ DRA. PAULA</span>
                  <span style="color:var(--ok)">● ONLINE</span>
                </div>
                <div class="op-mock-chat">
                  <div class="op-mock-msg">Pode dar uma olhada no exame da Sra. Joana? RX tórax + hemograma.</div>
                  <div class="op-mock-msg is-mine has-attachment">
                    <div class="op-mock-attachment"></div>
                    <div>RX-tórax-anonimizado.pdf · 1.2MB<br/><span style="font-size:10px;color:var(--text-3)">2 regiões redigidas</span></div>
                  </div>
                  <div class="op-mock-msg">Recebido. Vou revisar e respondo até amanhã. 👍</div>
                </div>
              </div>
            </div>
          </div>
          <div class="monitor-neck"></div>
          <div class="monitor-foot"></div>
        </div>
      </div>
    </div>
    <div class="feat-text-col">
      <div class="feat-num">04</div>
      <div class="feat-tag">Comunicação clínica</div>
      <h3 class="feat-heading">Encaminhe.<br/>Pergunte. Compartilhe.<br/><span class="feat-highlight">Sem WhatsApp.</span></h3>
      <p class="feat-body">Conversa 1:1 admin↔admin entre clínicas do mesmo módulo. Diretório opt-in, convite com aceite, anexos com <strong>redação automática de PII</strong> antes de enviar. Reações, busca full-text em português, denúncias com suspensão automática.</p>
      <div class="feat-stats">
        <div>
          <span class="feat-stat-val">PII</span>
          <span class="feat-stat-label">redigida no anexo</span>
        </div>
        <div>
          <span class="feat-stat-val">6</span>
          <span class="feat-stat-label">reações em whitelist</span>
        </div>
        <div>
          <span class="feat-stat-val">FTS</span>
          <span class="feat-stat-label">busca pt nativo</span>
        </div>
      </div>
      <div class="feat-disclaimer">
        <div class="feat-disclaimer-icon">🔒</div>
        <p>PDF e imagens redigidos automaticamente · Bloqueio bilateral · Suspensão automática por denúncia · Mobile-first responsive</p>
      </div>
    </div>
  </div>

  <!-- O5. Dashboard -->
  <div class="feat-block" id="feat-dashboard">
    <div class="feat-video-col">
      <div class="monitor-outer">
        <div class="monitor-frame">
          <div class="monitor-bezel">
            <div class="monitor-screen">
              <div class="op-mock">
                <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-3);letter-spacing:0.1em">
                  <span>DASHBOARD · TEMPO REAL</span>
                  <span style="color:var(--cross)"><span class="dot-red"></span> 3 ALERTAS</span>
                </div>
                <div class="op-mock-dashboard">
                  <div class="op-mock-kpi">
                    <div class="op-mock-kpi-val">12</div>
                    <div class="op-mock-kpi-label">Aguardando revisão</div>
                  </div>
                  <div class="op-mock-kpi">
                    <div class="op-mock-kpi-val">3</div>
                    <div class="op-mock-kpi-label">Alertas críticos</div>
                  </div>
                  <div class="op-mock-kpi">
                    <div class="op-mock-kpi-val">28%</div>
                    <div class="op-mock-kpi-label">Risco alto na carteira</div>
                  </div>
                  <div class="op-mock-kpi">
                    <div class="op-mock-kpi-val">847</div>
                    <div class="op-mock-kpi-label">Exames 14 dias</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="monitor-neck"></div>
          <div class="monitor-foot"></div>
        </div>
      </div>
    </div>
    <div class="feat-text-col">
      <div class="feat-num">05</div>
      <div class="feat-tag">Dashboard</div>
      <h3 class="feat-heading">O pulso da sua<br/><span class="feat-highlight">clínica em uma tela.</span></h3>
      <p class="feat-body">KPIs em tempo real: alertas críticos com link, exames aguardando revisão, donut de risco da carteira, top marcadores alterados, bar chart 14 dias. Tudo atualiza via <strong>WebSocket</strong> — zero F5.</p>
      <div class="feat-disclaimer">
        <div class="feat-disclaimer-icon">📊</div>
        <p>Atualização real-time via WS · Alertas críticos com deeplink · Donut de risco · Top 5 marcadores · Bar chart 14d</p>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Smoke test**

Browser. Confirmar:
- Click no botão "Ver Operação ↓" do pilar 2 rola pra `#operacao`
- Header "02 — Operação · A plataforma vai além da análise clínica."
- 5 blocos: Agenda (week grid mock), Voz (botão mic pulsando + transcrição), Prescrições (receituário mock), Chat clínicas (thread com PDF anonimizado), Dashboard (4 KPIs)
- Mock da agenda mostra eventos coloridos por status
- Botão de mic na seção Voz tem animação pulse
- Mobile: blocos empilham, mocks reduzem proporcional
- Nav `#operacao` funciona

Run: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): adicionar Pilar 2 Operação (5 blocos novos)

Bloco totalmente novo após o Pilar 1 IA Clínica. 5 features com mocks
de produto in-line:
- O1 Agenda nativa: week grid mock 7x15h com eventos coloridos
- O2 Copilot por voz (★): botão mic pulsante + transcrição animada
- O3 Prescrições com templates: receituário mock com chip PR-xxxxxx
- O4 Chat entre clínicas: thread com PDF anonimizado mock
- O5 Dashboard: 4 KPIs em grid (revisão, alertas, risco, exames 14d)

Sem deps novas (CSS+SVG inline).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Pilar 3 — Compliance & Segurança (BLOCO TODO NOVO)

**Files:**
- Modify: `apps/landing/index.html` — substituir `<section id="seguranca" class="security">` pelo novo Pilar 3 (~linha 2338)

- [ ] **Step 1: Adicionar CSS pra grid de compliance**

Após o CSS da Task 8, adicionar:

```css
    /* ── PILAR 3: COMPLIANCE ── */
    .compliance-section {
      padding: 80px 48px;
      border-bottom: 1px solid var(--line);
      background: var(--bg-1);
    }
    .compliance-header {
      margin-bottom: 56px;
      max-width: 800px;
    }
    .compliance-heading {
      font-size: clamp(40px, 5vw, 64px);
      font-weight: 800;
      letter-spacing: -0.04em;
      line-height: 1;
      margin-bottom: 20px;
    }
    .compliance-heading em {
      font-family: "Fraunces", serif;
      font-style: italic;
      font-weight: 600;
      color: var(--cross);
    }
    .compliance-sub {
      font-size: 16px;
      color: var(--text-2);
      line-height: 1.7;
    }
    .compliance-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 56px;
    }
    .compliance-card {
      background: var(--bg);
      border: 1px solid var(--line);
      padding: 28px 24px;
      transition: border-color 0.2s;
    }
    .compliance-card:hover {
      border-color: var(--cross);
    }
    .compliance-card.is-star {
      border-left: 3px solid var(--cross);
    }
    .compliance-card-icon {
      width: 28px;
      height: 28px;
      stroke: var(--cross);
      fill: none;
      stroke-width: 1.5;
      margin-bottom: 16px;
    }
    .compliance-card-title {
      font-size: 16px;
      font-weight: 800;
      color: var(--text);
      letter-spacing: -0.01em;
      margin-bottom: 10px;
    }
    .compliance-card-body {
      font-size: 13px;
      color: var(--text-2);
      line-height: 1.65;
    }
    .compliance-card-body strong { color: var(--text); font-weight: 700; }
    .compliance-badges {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 32px;
      border-top: 1px solid var(--line);
    }

    @media (max-width: 1024px) {
      .compliance-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 640px) {
      .compliance-grid { grid-template-columns: 1fr; }
    }
```

- [ ] **Step 2: Substituir bloco `<section id="seguranca" class="security">` pelo novo Pilar 3**

Localizar `<!-- SECURITY -->` (~linha 2337) e o `</section>` correspondente. Substituir o bloco INTEIRO por:

```html
<!-- ════════════════════════════════════════════ -->
<!-- PILAR 3: COMPLIANCE & SEGURANÇA               -->
<!-- ════════════════════════════════════════════ -->
<section id="compliance" class="compliance-section">
  <div class="compliance-header">
    <div class="section-label">03 — Compliance</div>
    <h2 class="compliance-heading">LGPD não é checkbox.<br/><em>É arquitetura.</em></h2>
    <p class="compliance-sub">Construímos GenomaFlow com isolamento multi-tenant from day one. Cada clínica em RLS estrito, audit log forense, consentimento documentado, anonimização automática. Conformidade não é um documento PDF — é o código rodando.</p>
  </div>

  <div class="compliance-grid">
    <article class="compliance-card is-star">
      <svg class="compliance-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="3" y1="9" x2="21" y2="9"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
        <rect x="11" y="11" width="3" height="3" fill="currentColor" stroke="none"/>
        <rect x="15" y="11" width="3" height="3" fill="currentColor" stroke="none"/>
        <rect x="11" y="15" width="3" height="3" fill="currentColor" stroke="none"/>
      </svg>
      <h3 class="compliance-card-title">Anonimização automática de PII</h3>
      <p class="compliance-card-body">Antes de qualquer anexo sair pra outra clínica, a plataforma extrai texto do PDF, identifica PII (nome, CPF, telefone, microchip, data de nascimento) com regex + IA e desenha <strong>retângulos pretos</strong> sobre as posições. Mantém o text layer. Imagens passam por canvas editor com Tesseract+IA detectando texto sensível.</p>
    </article>

    <article class="compliance-card">
      <svg class="compliance-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="13" y2="17"/>
      </svg>
      <h3 class="compliance-card-title">Audit log forense</h3>
      <p class="compliance-card-body">Toda mutação em pacientes, prescrições, exames e agenda gera linha imutável: quem, quando, o que mudou (diff JSONB), de onde (UI, Copilot, sistema, worker). Master vê tudo, tenant só o seu. <strong>Append-only</strong> no Postgres — nem o admin apaga.</p>
    </article>

    <article class="compliance-card">
      <svg class="compliance-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
      <h3 class="compliance-card-title">Consentimento LGPD do paciente</h3>
      <p class="compliance-card-body">Cadastro do paciente exige <strong>checkbox de consentimento</strong> + opção de baixar PDF de termo de consentimento gerado client-side com dados da clínica pré-preenchidos. Pronto pra arquivamento físico ou digital.</p>
    </article>

    <article class="compliance-card">
      <svg class="compliance-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="8.5" cy="7" r="4"/>
        <path d="M20 8v6"/>
        <path d="M23 11h-6"/>
      </svg>
      <h3 class="compliance-card-title">Onboarding profissional verificado</h3>
      <p class="compliance-card-body">5 documentos legais (contrato SaaS, DPA, política de incidentes, segurança, uso aceitável) com aceite registrado: <strong>hash SHA-256</strong> do conteúdo + IP + user-agent + timestamp. Profissional declara CRM/CRMV + UF com checkbox de veracidade.</p>
    </article>

    <article class="compliance-card">
      <svg class="compliance-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <h3 class="compliance-card-title">Single-session com sessão única</h3>
      <p class="compliance-card-body">Login emite <strong>jti único</strong>; segunda autenticação no mesmo usuário invalida a anterior. Snackbar avisa antes de deslogar — sem sessão fantasma em outra máquina.</p>
    </article>

    <article class="compliance-card">
      <svg class="compliance-card-icon" viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3"/>
        <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
        <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
      </svg>
      <h3 class="compliance-card-title">Multi-tenant defensivo</h3>
      <p class="compliance-card-body">RLS ENABLE+FORCE em todas as tabelas tenant-scoped + filtro <strong>AND tenant_id = $X</strong> explícito em toda query (defesa em profundidade). Mesmo se a RLS falhar por bug de role, o filtro segura.</p>
    </article>
  </div>

  <div class="compliance-badges">
    <span class="badge">LGPD COMPLIANT</span>
    <span class="badge">CFM RES. 2.314/2022</span>
    <span class="badge">MULTI-TENANT RLS</span>
    <span class="badge">AUDIT TRAIL</span>
    <span class="badge">AES-256 IN TRANSIT/REST</span>
  </div>
</section>
```

- [ ] **Step 3: Smoke test**

Browser. Confirmar:
- Click "Ver Compliance ↓" no pilar 3 do topo rola pra `#compliance`
- Header "03 — Compliance · LGPD não é checkbox. É arquitetura." (Fraunces italic vermelho na 2ª linha)
- 6 cards em grid 3×2: Anonimização (border-left vermelho destaque), Audit log, Consentimento, Onboarding, Single-session, Multi-tenant defensivo
- 5 selos no rodapé: LGPD COMPLIANT, CFM RES. 2.314/2022, MULTI-TENANT RLS, AUDIT TRAIL, AES-256
- Hover em card muda border pra vermelho
- Mobile <640px: cards empilham 1 coluna; tablet 2 colunas

Run: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): substituir security section por Pilar 3 Compliance

Bloco antigo "ANVISA CERTIFIED · ISO 27001 · 99.94% uptime" removido.
Substituído por Pilar 3 com:
- Header "LGPD não é checkbox. É arquitetura."
- 6 cards técnicos: Anonimização PII (★ destaque), Audit log forense,
  Consentimento, Onboarding profissional, Single-session, Multi-tenant
- 5 selos honestos: LGPD, CFM 2.314/2022, RLS, Audit Trail, AES-256

Argumento de venda forte pra clínicas que se preocupam com regulação.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Atualizar Impacto + Calculadora

**Files:**
- Modify: `apps/landing/index.html` — bloco `<section id="impacto" class="impact">` (~linha 2134) e `<section class="calc">` (~linha 2179)

- [ ] **Step 1: Atualizar KPIs do bloco Impacto**

Localizar `<div class="impact-kpis">` (~linha 2136) e substituir KPIs por:

```html
<div class="impact-kpis">
  <div class="impact-kpi">
    <div class="kpi-val">~70%</div>
    <div class="kpi-label">redução estimada do tempo<br/>de leitura por exame complexo</div>
    <div class="kpi-source">estimado · revisão pós-IA</div>
  </div>
  <div class="impact-kpi">
    <div class="kpi-val">5</div>
    <div class="kpi-label">agentes IA paralelos<br/>analisando o mesmo exame</div>
    <div class="kpi-source">arquitetura multi-agente</div>
  </div>
  <div class="impact-kpi">
    <div class="kpi-val">&lt; 60s</div>
    <div class="kpi-label">PDF → insight estruturado<br/>com fontes citadas</div>
    <div class="kpi-source">latência observada</div>
  </div>
  <div class="impact-kpi">
    <div class="kpi-val">99%</div>
    <div class="kpi-label">disponibilidade alvo<br/>(SLO operacional)</div>
    <div class="kpi-source">monitoria 2025</div>
  </div>
</div>
<p style="font-size:11px;color:var(--text-3);margin-top:24px;line-height:1.5;font-family:'JetBrains Mono',monospace;letter-spacing:0.03em">
  Estimativas baseadas em rotinas clínicas típicas; resultados variam por especialidade e volume.
</p>
```

- [ ] **Step 2: Atualizar Calculadora — copy + fórmula**

Localizar `<section class="calc">` (~linha 2179). Substituir o conteúdo INTEIRO por:

```html
<section class="calc">
  <div class="section-label">Calcule seu ganho estimado</div>
  <h2 class="calc-heading">Quanto a IA libera<br/><em style="font-family:'Fraunces',serif;font-style:italic;font-weight:600;color:var(--cross)">da sua semana?</em></h2>
  <p class="calc-sub">Estimativa de tempo e receita liberados ao reduzir leitura manual de exames. Ajuste pra refletir sua rotina.</p>
  <div class="calc-body">
    <div class="calc-sliders">
      <div class="slider-group">
        <label>
          <span class="slider-name">Exames analisados por dia</span>
          <span class="slider-val" id="calc-vol">10</span>
        </label>
        <input type="range" id="calc-vol-input" min="1" max="50" value="10"/>
      </div>
      <div class="slider-group">
        <label>
          <span class="slider-name">Minutos lidos manualmente por exame</span>
          <span class="slider-val" id="calc-min">12</span>
        </label>
        <input type="range" id="calc-min-input" min="5" max="30" value="12"/>
      </div>
      <div class="slider-group">
        <label>
          <span class="slider-name">Valor médio da consulta (R$)</span>
          <span class="slider-val" id="calc-val">250</span>
        </label>
        <input type="range" id="calc-val-input" min="100" max="500" value="250" step="10"/>
      </div>
    </div>
    <div class="calc-results">
      <div class="calc-result">
        <div class="result-val" id="calc-hours">36h</div>
        <div class="result-label">economizadas/mês</div>
        <div class="result-note">22 dias úteis · revisão pós-IA ≈ 2min</div>
      </div>
      <div class="calc-result">
        <div class="result-val" id="calc-extra">72</div>
        <div class="result-label">consultas extras possíveis</div>
        <div class="result-note">consulta padrão = 30min</div>
      </div>
      <div class="calc-result highlight">
        <div class="result-val" id="calc-rev">R$ 18.000</div>
        <div class="result-label">receita adicional estimada/mês</div>
        <div class="result-note">consultas extras × valor médio</div>
      </div>
    </div>
  </div>
  <p style="font-size:11px;color:var(--text-3);margin-top:32px;line-height:1.5;font-family:'JetBrains Mono',monospace;letter-spacing:0.03em">
    Estimativas indicativas. Resultado real depende de especialidade, complexidade dos exames e volume.
  </p>
</section>
```

- [ ] **Step 3: Adicionar JS da calculadora antes do `</script>` (próximo ao final)**

Localizar o final do bloco `<script>` (próximo de `</script>` na linha ~2470). Antes do fechamento, adicionar:

```javascript
  // ── CALCULADORA ──
  (function initCalc() {
    const volInput = document.getElementById('calc-vol-input');
    const minInput = document.getElementById('calc-min-input');
    const valInput = document.getElementById('calc-val-input');
    if (!volInput) return;

    const volOut = document.getElementById('calc-vol');
    const minOut = document.getElementById('calc-min');
    const valOut = document.getElementById('calc-val');
    const hoursOut = document.getElementById('calc-hours');
    const extraOut = document.getElementById('calc-extra');
    const revOut = document.getElementById('calc-rev');

    function fmt(n) {
      return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    function update() {
      const vol = parseInt(volInput.value, 10);
      const min = parseInt(minInput.value, 10);
      const val = parseInt(valInput.value, 10);

      volOut.textContent = vol;
      minOut.textContent = min;
      valOut.textContent = val;

      const reviewedMin = 2;
      const savedPerExam = Math.max(0, min - reviewedMin);
      const minutesSaved = vol * savedPerExam * 22; // 22 dias úteis
      const hours = Math.round(minutesSaved / 60);
      const extra = Math.floor(hours * 2); // 1 consulta = 30 min
      const rev = extra * val;

      hoursOut.textContent = hours + 'h';
      extraOut.textContent = fmt(extra);
      revOut.textContent = 'R$ ' + fmt(rev);
    }

    [volInput, minInput, valInput].forEach(el => {
      el.addEventListener('input', update);
    });
    update();
  })();
```

- [ ] **Step 4: Smoke test**

Browser. Confirmar:
- Impacto agora mostra 4 KPIs honestos (~70%, 5 agentes, <60s, 99%)
- Disclaimer abaixo dos KPIs
- Calculadora tem 3 sliders (exames/dia, minutos/exame, valor consulta)
- Mover sliders atualiza horas economizadas, consultas extras, receita
- Default: 10 exames × 12 min × R$ 250 → 36h, 72 consultas, R$ 18.000
- Mobile: sliders e resultados empilham bem

Run: `kill %1`

- [ ] **Step 5: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): impacto + calculadora com números honestos

Impacto: 4 KPIs estimados (~70% redução, 5 agentes IA, <60s, 99% uptime)
com source label e disclaimer. Substitui métricas anteriores que mantinham
algumas fictícias.

Calculadora: 3 sliders (exames/dia, min/exame, valor consulta) calculam
horas economizadas, consultas extras possíveis e receita adicional
mensal estimada. Disclaimer reforçado.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Atualizar Pricing + FAQ + Footer CTA + Footer

**Files:**
- Modify: `apps/landing/index.html` — pricing (~linha 2235), faq (~linha 2290), footer-cta (~linha 2359), footer (~linha 2367)

- [ ] **Step 1: Adicionar linha "incluso no plano base" no Pricing**

Localizar `<div class="pricing-plan featured">` (~linha 2244). Antes do `<a class="pricing-cta">`, adicionar:

```html
<div style="margin-bottom:18px;padding-top:18px;border-top:1px dashed var(--line-soft);font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-2);letter-spacing:0.05em;line-height:1.6">
  Inclui agenda, copilot por voz, chat entre clínicas, dashboard e compliance — tudo no plano base. Créditos pagam apenas execução de agentes IA.
</div>
```

- [ ] **Step 2: Substituir lista do FAQ pelas 8 perguntas atualizadas**

Localizar `<div class="faq-list">` (~linha 2292). Substituir TODOS os `<div class="faq-item">` pelas 8 novas:

```html
<div class="faq-list">

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      Os laudos gerados substituem o diagnóstico médico?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Não. GenomaFlow é uma ferramenta de suporte à decisão clínica assistiva. Todo insight é auxiliar ao clínico responsável, nunca substituto do diagnóstico primário. Cada inferência expõe fonte, confiança e cadeia de raciocínio — auditável por design.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      Quanto tempo leva pra começar a usar?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Cadastro em 5 minutos com aceite dos documentos legais (LGPD) e declaração de CRM/CRMV. Primeiro exame analisado em 1 minuto após upload. Sem instalação, sem integração com sistema legado — você sobe o PDF e a IA analisa.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      Como funciona a cobrança por crédito?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Cada agente de IA executado consome 1 crédito. Um laudo típico humano consome 2–4 créditos (extração, correlação, RAG, síntese). Laudos veterinários consomem 2–3. Imagens consomem 1–2. Você vê o consumo em tempo real no console. Agenda, voz, chat, dashboard, prescrições — todos inclusos no plano base, sem cobrar crédito.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      Os dados dos pacientes são usados pra treinamento de modelos?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Nunca. Contratualmente e tecnicamente. Os modelos não são fine-tuned com dados de clínicas. Cada tenant opera em isolamento lógico (RLS multi-tenant) e os documentos clínicos são processados sem retenção pra treinamento.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      A agenda e o copilot por voz são pagos à parte?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Não. Agenda nativa, copilot por voz, chat entre clínicas, dashboard, prescrições e compliance — tudo incluso no plano base de R$ 199/mês. Créditos pagam apenas a execução dos agentes de IA.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      O copilot por voz funciona em qualquer navegador?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Funciona em Chrome, Edge e Safari (incluindo mobile). Firefox não tem Web Speech API nativa, então o botão de mic fica oculto pra usuários nesse navegador (sem fallback). Áudio nunca sai do navegador — só o texto transcrito vai pro servidor.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      Como funciona a anonimização de PII em anexos?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Pra PDFs com text layer: extraímos texto e posições com pdfjs-dist, identificamos PII (nome, CPF, telefone, microchip, data) com regex + IA, e desenhamos retângulos pretos sobre as posições com pdf-lib — tudo client-side antes de fazer upload. Pra PDFs escaneados ou imagens: canvas editor com Tesseract+IA detecta texto sensível pra você confirmar redação manual. Anexo só sai com PII redigida.</div>
  </div>

  <div class="faq-item">
    <button class="faq-q" onclick="toggleFaq(this)">
      Atendem clínicas veterinárias de pequeno porte?
      <span class="faq-icon">+</span>
    </button>
    <div class="faq-a">Sim. O plano base R$ 199/mês é dimensionado pra clínicas solo. Escalamos automaticamente via créditos conforme o volume — sem tier forçado. Módulo veterinário cobre pequenos animais, equinos e bovinos com agentes específicos por espécie.</div>
  </div>

</div>
```

- [ ] **Step 3: Atualizar Footer CTA copy**

Localizar `<section class="footer-cta">` (~linha 2359). Substituir conteúdo:

```html
<section class="footer-cta">
  <div class="section-label">Pronto pra começar?</div>
  <div class="footer-cta-heading">LIBERE HORAS<br/>DA SUA<br/><span style="color:var(--cross)">ROTINA CLÍNICA.</span></div>
  <p class="footer-cta-sub">5 minutos pra começar. Comece pelo módulo do seu jeito de trabalhar.</p>
  <div style="display:flex;gap:24px;align-items:center">
    <a class="btn-primary" style="font-size:14px;padding:14px 32px" data-cta="/onboarding">Criar conta →</a>
    <a class="hero-link-ghost" data-cta="/login">Já sou cliente · Entrar</a>
  </div>
</section>
```

- [ ] **Step 4: Atualizar links do Footer**

Localizar `<footer class="footer">` (~linha 2367). Substituir conteúdo:

```html
<footer class="footer">
  <div class="footer-brand">
    © 2026 GenomaFlow · Inteligência Clínica Assistiva
  </div>
  <ul class="footer-links">
    <li><a href="#compliance">LGPD</a></li>
    <li><a href="#compliance">Compliance</a></li>
    <li><a href="#faq">FAQ</a></li>
    <li><a href="#precos">Planos</a></li>
  </ul>
</footer>
```

- [ ] **Step 5: Smoke test**

Browser. Confirmar:
- Pricing tem nova linha "Inclui agenda, copilot por voz..."
- FAQ tem 8 perguntas, as 3 novas (agenda paga, voz, anonimização) aparecem
- Click em qualquer pergunta abre/fecha o accordion
- Footer CTA: "LIBERE HORAS DA SUA ROTINA CLÍNICA"
- 2 botões no footer CTA: Criar conta + Já sou cliente
- Footer links apontam pra ancoras internas
- Mobile: tudo empilha sem quebra

Run: `kill %1`

- [ ] **Step 6: Commit**

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
feat(landing): pricing/FAQ/footer atualizados pra refletir features

Pricing: nova linha enfatizando que agenda, voz, chat, dashboard,
compliance estão inclusos no plano base.

FAQ: 8 perguntas (3 novas — agenda paga? voz funciona em qual browser?
anonimização PII como funciona?). Reescrita das antigas pra remover
referência a File Drop / HL7 inexistentes.

Footer CTA: "LIBERE HORAS DA SUA ROTINA CLÍNICA" + 2 CTAs (criar conta
+ entrar). Substitui "REDUZA TEMPO DE LAUDO 80%".

Footer: links agora apontam pras ancoras internas (LGPD, Compliance,
FAQ, Planos). Versão removida do brand.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Smoke test cross-browser + mobile + lighthouse

**Files:** Nenhum modificado nesta task — só validação.

- [ ] **Step 1: Smoke desktop em Chrome**

Run: `python3 -m http.server 8000 --directory apps/landing/ &`

Manualmente verificar (sem persona definida):
- Top bar aparece em primeira visita
- Click "Atendo humanos" → barra some, pill nav fica em "Humano"
- Refresh: barra não volta, pill mantém "Humano"
- Click "Vet" no pill → módulo Humano esmaece, módulo Vet destaca
- Scroll todo: nenhuma quebra de layout, sem horizontal scroll, todos os ancores funcionam (#modulos, #pilares, #ia, #operacao, #compliance, #precos, #faq)
- Calculadora: sliders atualizam outputs em tempo real
- FAQ: cada item abre/fecha
- Vídeos da seção IA Clínica autoplay sem audio

- [ ] **Step 2: Smoke mobile em DevTools (375×812 — iPhone X)**

DevTools → Toggle Device Toolbar → 375px width:
- Top bar empilha em 2 linhas
- Hero título reduz proporcional (clamp funciona)
- Métricas hero ficam 2 colunas
- 3 Pilares empilha 1 coluna
- Módulos Human/Vet empilham 1 coluna
- Pilar 1, 2, 3 — feature blocks empilham (texto sobre vídeo)
- Compliance grid vira 1 coluna
- Pricing: cards empilham
- FAQ: full width, sem corte
- Footer CTA: botões empilham se preciso

- [ ] **Step 3: Lighthouse audit**

Em DevTools → Lighthouse → Mobile + Performance + Accessibility + Best Practices + SEO → Generate report.

Expected (aceitável):
- Performance ≥ 85 (vídeos pesam, mas placeholder estático vale)
- Accessibility ≥ 95
- Best Practices ≥ 90
- SEO ≥ 90

Anotar issues. Se Accessibility cair abaixo de 95, verificar:
- `aria-label` nos botões SVG-only (já incluí)
- `alt` nas imagens (sem imagens externas)
- Contraste — `text-3` (#6e6e76) sobre `bg` (#0a0a0c) é o limite; verificar se passa AA

- [ ] **Step 4: Page weight**

Run: `wc -c apps/landing/index.html && du -sh apps/landing/videos/`

Expected: HTML <120KB, vídeos não inflados além do que já estavam. Total transfer (sem vídeos preload) < 250KB.

- [ ] **Step 5: Commit (se ajustes necessários após lighthouse)**

Se for preciso ajustar contraste, adicionar `loading="lazy"` em vídeos abaixo do fold, etc — aplicar e commitar:

```bash
git add apps/landing/index.html
git commit -m "$(cat <<'EOF'
fix(landing): ajustes de a11y e performance pós-lighthouse

[detalhes específicos do que foi ajustado]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Se nenhum ajuste for necessário, pular este step.

- [ ] **Step 6: Run no http.server final**

Run: `kill %1` (parar servidor).

---

## Task 13: Push da branch + abrir PR

**Files:** Nenhum modificado.

- [ ] **Step 1: Verificar histórico da branch**

Run: `git log --oneline main..HEAD`

Expected: ~12 commits (1 chore inicial + 1 por seção implementada + possível 1 fix de a11y).

- [ ] **Step 2: Push da branch pro remote**

Run: `git push -u origin feat/landing-page-update`

Expected: branch criada no remote.

- [ ] **Step 3: NÃO criar PR ainda**

Apresentar resultado pro usuário em local primeiro:
- Mensagem indicando: "Landing page atualizada na branch `feat/landing-page-update`. Rodando localmente: `python3 -m http.server 8000 --directory apps/landing/`. Aprova pra mergear na main?"

Aguardar aprovação humana antes de mergear (regra do projeto: nada vai pra main sem ok explícito).

- [ ] **Step 4: Após aprovação, mergear na main**

```bash
git checkout main
git pull origin main
git merge --no-ff feat/landing-page-update -m "merge: feat/landing-page-update → main

Atualiza landing page com features novas (agenda, voz, chat clínicas,
dashboard, compliance) refletindo a plataforma operacional clínica
completa. Métricas e selos fictícios removidos; estimativas honestas
com disclaimer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: Aguardar deploy GitHub Actions**

Run: `gh run watch` (ou abrir Actions tab em github.com)

Expected: pipeline `deploy.yml` roda em ~10–15min e atualiza ECS Fargate (genomaflow-web).

- [ ] **Step 6: Smoke em prod**

Após deploy completo, abrir `https://genomaflow.com.br` em browser limpo (incognito).

Expected: nova landing carrega, top bar aparece, todas features novas visíveis.

---

## Self-review

### Spec coverage

- [x] Top bar 1ª visita → Task 2
- [x] Nav toggle Médico/Vet → Task 3
- [x] Hero repivotado → Task 4
- [x] Marquee atualizado → Task 5
- [x] 3 Pilares (substitui logos) → Task 5
- [x] Módulos Human×Vet com códigos reais + reagir ao toggle → Task 6
- [x] Pilar 1 IA Clínica com F3 Imagens novo → Task 7
- [x] Pilar 2 Operação (5 blocos novos) → Task 8
- [x] Pilar 3 Compliance (6 cards) → Task 9
- [x] Impacto e Calculadora atualizados → Task 10
- [x] Pricing com linha de "incluso" → Task 11
- [x] FAQ com 8 perguntas (3 novas) → Task 11
- [x] Footer CTA + Footer ajustados → Task 11
- [x] Limpar `apps/web/landing/` órfão → Task 1
- [x] Smoke + lighthouse + mobile → Task 12
- [x] Push + merge → Task 13

### Placeholder scan

- Sem "TBD", "TODO", "implement later"
- Todos os steps de código têm code blocks completos
- Comandos exatos com expected output
- Disclaimer das estimativas é literal e replicado em todas as seções

### Type consistency

- `setPersona(persona)` definido na Task 3 e referenciado na Task 2 (forward ref OK porque o IIFE da Task 2 é re-escrito completamente na Task 3, ganhando acesso ao setPersona)
- `data-set-persona` attribute name consistente em top bar e nav pill
- `localStorage.getItem('genoma_persona')` e `genoma_persona_hint_dismissed` usados em ambas Tasks 2 e 3 com mesmas keys
- IDs de seção (`#pilares`, `#ia`, `#operacao`, `#compliance`, `#modulos`, `#produto`, `#impacto`, `#precos`, `#faq`) usados consistentemente entre nav-links, pillar-cta e referências internas
- Classes CSS (`feat-block`, `feat-block--rev`, `monitor-frame`) reaproveitadas dos blocos existentes — sem renomeação
- `op-mock` é o único namespace de mock novo, exclusivo da Task 8

### Scope check

Single page, single file. Trabalho linear. Não exige decomposição. Plano cobre toda a spec. Pronto pra execução.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-29-landing-page-update.md`.

> **Nota sobre frontend-design:** o usuário mencionou querer usar o skill `frontend-design:frontend-design` na conversa original. Como este plano é predominantemente HTML/CSS estático sobre um arquivo existente com design system bem definido (Inter Tight + Fraunces + JetBrains Mono, paleta dark com accent vermelho), o trabalho é reaproveitamento + extensão visual mais do que criação de design novo. Ainda assim, no momento da execução o agente pode invocar `frontend-design:frontend-design` em tarefas específicas (ex: refinamento dos mocks da Task 8 — agenda, voz, chat — pra elevar o nível visual além do scaffold deste plano).

Two execution options:

**1. Subagent-Driven (recommended)** — dispatcho um subagent fresco por task, review entre tasks, iteração rápida.

**2. Inline Execution** — executo as tarefas nesta sessão usando executing-plans, batch execution com checkpoints pra review.

**Which approach?**
