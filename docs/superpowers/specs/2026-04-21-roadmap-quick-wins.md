# GenomaFlow — Roadmap de Quick Wins e Features Futuras

**Última atualização:** 2026-04-23

Status possíveis: `pending` | `in_progress` | `done`

---

## Quick Wins (1-3 dias)

| # | Feature | Módulo | Status | Notas |
|---|---------|--------|--------|-------|
| 1 | **Exportar resultado da IA como PDF** — botão "Exportar Análise" no result-panel gerando PDF com interpretação, alertas e recomendações de todos os agentes | human + veterinary | `done` (2026-04-22) | Implementado em `shared/utils/analysis-pdf.ts` via jsPDF. Cabeçalho com logo/CNPJ da clínica, badges por severidade, disclaimer no rodapé + paginação |
| 2 | **Busca rápida no topbar** — campo de busca por nome de paciente/animal acessível de qualquer tela, navega direto ao perfil | human + veterinary | `done` (2026-04-22) | `QuickSearchComponent` no topbar; atalho `/` para focar; placeholder módulo-aware; normalização de acentos via NFD; até 8 resultados; reload on focus para safety |
| 3 | **Notificação quando exame conclui** — push notification ou email disparado pelo evento `exam:done` já existente no WebSocket | human + veterinary | `pending` | WebSocket já emite o evento; falta integração com provider de email/push (FCM ou similar) |
| 4 | **Calculadora de dose por peso (veterinário)** — na PrescriptionModal, calcular dose total automaticamente a partir de dose/kg × peso do animal cadastrado | veterinary | `pending` | Requer peso preenchido no perfil do animal. Campo `weight` já existe em subjects |

---

## Médio Prazo (alto impacto)

| # | Feature | Módulo | Status | Notas |
|---|---------|--------|--------|-------|
| 5 | **Gráfico de evolução por marcador** — selecionar marcador (glicemia, creatinina, etc.) e ver curva histórica ao longo de todos os exames do paciente | human + veterinary | `done` (2026-04-22) | Aba Evolução com 2 modos: "Comparar exames" e "Por marcador". Seleciona até 3 marcadores numéricos, line chart Chart.js, legenda com min/max/último + ícone de tendência (up/down/flat) calculado por delta com threshold 5% |
| 6 | **Dashboard de alertas críticos** — centralizar todos os pacientes com alertas `critical` dos últimos 30 dias; muda o fluxo de triagem | human + veterinary | `done` (2026-04-22) | Dashboard enriquecido com 4 novos blocos via endpoint `/dashboard/insights`: distribuição de risco da carteira (donut), top 5 marcadores alterados, alertas críticos com link + nome do paciente, exames aguardando revisão |
| 7 | **Templates de receita** — salvar receita como template reutilizável (ex: "protocolo DM2 padrão") e aplicar com um clique | human + veterinary | `done` (2026-04-22) | Migration 045 `prescription_templates` (por tenant com RLS). CRUD completo. Barra no topo do PrescriptionModal com "Aplicar template" + "Salvar como template". Aplicar **substitui** itens (decisão de escopo para evitar duplicatas) |

---

## Post-MVP (grandes features estratégicas)

| # | Feature | Status | Notas |
|---|---------|--------|-------|
| A | **Análise Longitudinal** — agentes recebem série histórica do paciente, detectam tendência antes do médico ver | `pending` | Diferencial competitivo real. Output: `trend` por marcador + taxa de variação |
| B | **Alertas Críticos Proativos** — WhatsApp/email/webhook disparado automaticamente ao detectar valor crítico | `pending` | UTI/PS. Requer integração com provider (WhatsApp Business API, SES) + configuração por tenant |
| C | **Dashboard do Gestor** — visão agregada da carteira: distribuição de risco, exames críticos pendentes, top marcadores | `partial` | Versão inicial entregue em 2026-04-22 (item 6). Falta: filtros por período/agente/médico, export PDF/Excel |
| D | **API para Laboratórios (B2B)** — labs integram, oferecem interpretação como valor agregado junto ao laudo | `pending` | Volume B2B com CAC ~zero. Requer endpoint `/api/v1/analyze`, API keys, rate limiting, portal do lab, SLA <60s |

---

## Débito Natural (surgiu durante implementação)

| Item | Status | Prioridade |
|------|--------|-----------|
| Revogação de consentimento LGPD (hoje só grava, não desfaz) — Art 18 IX LGPD | `pending` | Alta — compliance |
| Upload do termo assinado escaneado (hoje só checkbox) | `pending` | Média |
| Histórico de aceite dos termos visível no perfil do usuário | `pending` | Média |
| Gestão de sessões ativas (ver dispositivos) | `pending` | Baixa |
| Validação manual de CRM no master panel + invalidação se dado incorreto | `pending` | Média |
| Re-envio de termos ao mudar UF/CRM (renovação anual) | `pending` | Baixa |

---

## Já Implementado (referência histórica — últimos deploys)

| Feature | Data | Observação |
|---------|------|------------|
| **Fix: busca rápida não filtrava (query era string, não signal)** | 2026-04-23 | Bug crítico de reatividade — computed cacheava [] da primeira avaliação. Ver `feedback_code_editing_rules.md` |
| Busca rápida: label módulo-aware + reload on focus | 2026-04-23 | Fix UX — "Buscar paciente" / "Buscar animal" + safety net |
| Dashboard enriquecido (feature 6) | 2026-04-23 | 4 novos blocos via `/dashboard/insights` |
| Gráfico de evolução por marcador (feature 5) | 2026-04-23 | Chart.js, até 3 séries |
| Templates de receita (feature 7) | 2026-04-23 | Migration 045, CRUD + UI no modal |
| Busca rápida no topbar (feature 2) | 2026-04-23 | Componente + atalho `/` |
| Exportar análise da IA como PDF (feature 1) | 2026-04-23 | jsPDF client-side |
| PDFs legais v1.2 com SLA de suporte | 2026-04-22 | 24h primeiro contato / 48h úteis bug crítico / sem treinamento |
| CRM/CRMV + UF + declaração de veracidade obrigatória | 2026-04-22 | Migration 044, guard bloqueante no onboarding |
| Aceite de 5 documentos legais com IP+timestamp | 2026-04-22 | Migration 042, guard bloqueante |
| Single-session per user (Redis jti) | 2026-04-22 | Login novo desloga dispositivo antigo |
| Consentimento LGPD do paciente | 2026-04-22 | Migration 043, checkbox + template PDF |
| Autocomplete de dono + busca por nome | 2026-04-22 | MatAutocomplete em 2 telas |
| Form de dono: máscaras CPF/telefone/CEP + ViaCEP | 2026-04-22 | Migration 041, campos estruturados |
| Chip de tipo clínico (HEMATOLOGIA, RX, RESSONÂNCIA…) + ID EX-/PR- | 2026-04-22 | Prefixo PR evita conflito com RX radiografia |
| Prescrições da IA na aba Tratamentos | 2026-04-22 | Link "Baseada em EX-xxx · TIPO" |
| Badge da Fila de Revisão em tempo real | 2026-04-22 | `refreshCount()` via WS examUpdates$ |
| Upload de imagens no patient-detail | 2026-04-22 | Pula painel de agentes para imagens |
| Card de paciente/animal clicável → perfil | 2026-04-22 | `[routerLink]` no card + stopPropagation nas ações |
| Favicon com logo GenomaFlow multi-resolução | 2026-04-22 | 32/192/512 + favicon.ico |
| Fix: MIME de imagem + auto-update WS + upload no feedback | 2026-04-22 | 3 bugs críticos |
