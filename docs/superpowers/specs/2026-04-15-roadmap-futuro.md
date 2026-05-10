# GenomaFlow — Roadmap Futuro (Post-MVP)

> Itens priorizados para fases seguintes após estabilização do core de análise de laudos.
> Ordenados por valor de negócio, não por complexidade técnica.

---

## Item 1 — Análise Longitudinal de Pacientes

**Objetivo:** Comparar automaticamente exames do mesmo paciente ao longo do tempo, detectando tendências e progressões de risco antes do médico perceber.

**Valor:** É a funcionalidade que diferencia interpretação pontual de acompanhamento clínico real. Nenhum sistema faz isso bem hoje no Brasil.

**O que fazer:**
- Ao processar um exame, buscar exames anteriores do mesmo paciente (mesmo tenant)
- Agentes recebem no contexto não só o exame atual, mas série histórica dos marcadores relevantes
- Output adicional: `trend` por marcador (`stable | worsening | improving`) + taxa de variação
- UI: linha do tempo por marcador com sparkline mostrando evolução
- Alertar quando tendência é de piora mesmo que valor ainda esteja dentro da referência

**Dependências:** nenhuma — dados já existem no banco.

---

## Item 2 — Alertas Críticos Proativos

**Objetivo:** Quando um agente detecta valor crítico, notificar o médico responsável imediatamente — sem ele precisar abrir o sistema.

**Valor:** Caso de uso de UTI e pronto-socorro. Diferencial de segurança clínica que gestores valorizam para contratar.

**O que fazer:**
- Configuração por tenant: canal de notificação (e-mail, WhatsApp Business API, webhook)
- Médico responsável vinculado ao paciente ou ao exame
- Alertas com threshold configurável por marcador (ex: glicose > 400 → alerta imediato)
- Log de alertas enviados por exam para auditoria (LGPD)
- Interface de configuração de alertas no painel admin

**Dependências:** Item de integração (para saber qual médico é responsável) ou configuração manual.

---

## Item 3 — Dashboard do Gestor (Visão de Carteira)

**Objetivo:** Visão agregada da carteira de pacientes do tenant — distribuição de risco, exames críticos pendentes, tendências populacionais.

**Valor:** É o produto que o **diretor médico e o CMO compram** — não o médico. Fechamento de contrato enterprise.

**O que fazer:**
- Painel com distribuição de risco (LOW/MEDIUM/HIGH/CRITICAL) da carteira ativa
- Exames com alertas críticos não visualizados (fila de atenção)
- Top marcadores alterados na carteira (ex: "42% dos pacientes com triglicerídeos acima da referência")
- Filtros por período, agente clínico, médico responsável
- Export em PDF/Excel para relatórios gerenciais
- Indicadores de uso da plataforma (exames processados, tempo médio de análise)

**Dependências:** Item 1 (longitudinal) para análises de tendência agregada.

---

## Item 4 — API para Laboratórios (B2B)

**Objetivo:** Laboratórios integram via API e oferecem interpretação clínica como serviço de valor agregado junto ao laudo — sem o paciente ou médico precisar usar outra plataforma.

**Valor:** Modelo B2B com volume. Um lab processando 5.000 exames/mês é receita recorrente significativa com CAC praticamente zero.

**O que fazer:**
- Endpoint dedicado `POST /api/v1/analyze` — recebe PDF ou dados estruturados, retorna interpretação
- API key por lab com rate limiting e billing por volume
- Webhook de retorno quando análise terminar (async)
- Portal do lab: histórico de requests, consumo, billing
- SLA garantido (ex: análise em < 60s para 95% dos casos)
- Sandbox para integração e testes

**Dependências:** Estabilidade do pipeline de agentes. Sem dependência de items anteriores.

---
