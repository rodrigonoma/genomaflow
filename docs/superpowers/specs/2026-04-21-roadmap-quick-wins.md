# GenomaFlow — Roadmap de Quick Wins e Features Futuras

**Última atualização:** 2026-04-21

Status possíveis: `pending` | `in_progress` | `done`

---

## Quick Wins (1-3 dias)

| # | Feature | Módulo | Status | Notas |
|---|---------|--------|--------|-------|
| 1 | **Exportar resultado da IA como PDF** — botão "Exportar Análise" no result-panel gerando PDF com interpretação, alertas e recomendações de todos os agentes | human + veterinary | `pending` | jsPDF já instalado |
| 2 | **Busca rápida no topbar** — campo de busca por nome de paciente/animal acessível de qualquer tela, navega direto ao perfil | human + veterinary | `pending` | Reduz atrito no fluxo principal |
| 3 | **Notificação quando exame conclui** — push notification ou email disparado pelo evento `exam:done` já existente no WebSocket | human + veterinary | `pending` | WebSocket já emite o evento |
| 4 | **Calculadora de dose por peso (veterinário)** — na PrescriptionModal, calcular dose total automaticamente a partir de dose/kg × peso do animal cadastrado | veterinary | `pending` | Requer peso preenchido no perfil do animal |

---

## Médio Prazo (alto impacto)

| # | Feature | Módulo | Status | Notas |
|---|---------|--------|--------|-------|
| 5 | **Gráfico de evolução por marcador** — selecionar marcador (glicemia, creatinina, etc.) e ver curva histórica ao longo de todos os exames do paciente | human + veterinary | `pending` | Comparador atual mostra só 2 exames |
| 6 | **Dashboard de alertas críticos** — centralizar todos os pacientes com alertas `critical` dos últimos 30 dias; muda o fluxo de triagem | human + veterinary | `pending` | Hoje o médico precisa entrar em cada exame individualmente |
| 7 | **Templates de receita** — salvar receita como template reutilizável (ex: "protocolo DM2 padrão") e aplicar com um clique | human + veterinary | `pending` | Alta frequência de uso para médicos com perfil repetitivo |

---

## Já Implementado (referência)

| Feature | Data | Branch/PR |
|---------|------|-----------|
| Receita médica/veterinária gerada por IA — modal de edição, PDF via jsPDF, WhatsApp, email 501 | 2026-04-21 | `feat/prescription` |
| Perfil da clínica — nome, CNPJ, logo | 2026-04-21 | `feat/prescription` |
| Exame atualiza em tempo real via WebSocket (sem F5) | 2026-04-21 | `fix/patient-detail-realtime-exam-update` |
| Verificação de email duplicado no step 1 do onboarding | 2026-04-21 | — |
| Error log com tenant/user corretos | 2026-04-21 | — |
| Landing page com CTA correto (Registrar → onboarding) | 2026-04-21 | — |
