---
name: Regras de edição de código — lições de abril/2026
description: Write proibido, stash proibido, sem vibe coding, sem afirmações sem verificar, signals reativos no Angular, uma concern por branch, smoke test antes de aprovar
type: feedback
---
**Write é proibido em arquivos existentes.** Usar sempre Edit cirúrgico.

**Why:** Em 2026-04-21, usar Write em app.routes.ts apagou a rota /master que não estava no arquivo lido mas deveria existir. Reescrever arquivo inteiro = apagar o que não foi lido.

**How to apply:** Write só para arquivos novos. Arquivo existente → Edit, sempre.

---

**git stash é proibido.** Trabalho em progresso vira commit `WIP:` na branch e é empurrado.

**Why:** Em 2026-04-21, código correto do exam-card e styles.scss existia só em stash `412fe26d` que nunca foi commitado. Cada deploy foi com o código errado (mat-card branco, abas invisíveis). Stash não tem histórico, não vai para remoto.

**How to apply:** Sempre `git add && git commit -m "WIP: descrição"` e push. Nunca stash.

---

**Uma concern por branch.**

**Why:** Misturar role elimination + routing master + dashboard charts numa branch causou múltiplas regressões difíceis de isolar.

**How to apply:** Se duas coisas precisam mudar, dois PRs separados e aprovados separadamente.

---

**Smoke test obrigatório antes de pedir aprovação:** login admin → dashboard, login master → painel master, telas críticas carregam.

**Why:** A rota /master quebrada foi só descoberta em produção porque não foi testada localmente antes do merge.

**How to apply:** Testar localmente com docker compose up antes de apresentar para aprovação. Se algo não puder ser testado, declarar explicitamente.

---

**Verificar migrations pendentes antes de mergear.**

**Why:** Migration 034 estava pendente em produção (runner com bug de permissão). Quando o bug foi corrigido, 034 aplicou pela primeira vez em prod, trocando senha master sem aviso.

**How to apply:** Antes de mergear, comparar arquivos em migrations/ com _migrations table para identificar o que será aplicado em produção pela primeira vez.

---

**Nunca fazer afirmações categóricas sem verificar com ferramentas.**

**Why:** Em 2026-04-21, afirmei que o campo de upload de screenshot "nunca existiu" e que "não há stash" — ambas eram mentiras. O código existia em stash WIP (commit 412fe26d) e foi perdido. O usuário perdeu código real por causa de afirmações sem fundamento.

**How to apply:** Antes de dizer "não existe", "nunca existiu" ou "não há stash": rodar `git stash list`, `git log --all --oneline | grep -i "wip\|stash"` e verificar o histórico completo. Se não verificou com ferramenta, não afirme.

---

**Vibe coding é proibido.**

**Why:** Em 2026-04-21, foram feitas múltiplas correções sequenciais pequenas sem diagnóstico completo — cada "fix" gerava um novo bug. O resultado foi uma cadeia de commits de hotfix que mascarou a causa raiz e acumulou regressões.

**How to apply:** Fluxo obrigatório: (1) ler TODOS os arquivos relevantes, (2) diagnosticar a causa raiz completa, (3) propor solução ao usuário, (4) implementar de uma vez em commit único. Nunca corrigir sintoma sem entender a causa.

---

**Verificar stash e histórico WIP no início de cada sessão.**

**Why:** Código perdido em stashes anteriores (412fe26d, b559156a) só foi descoberto porque o usuário insistiu. Sem verificação proativa, código válido fica enterrado no histórico.

**How to apply:** No início de cada sessão: `git stash list` e `git log --all --oneline | grep -i "wip\|stash"`. Se houver stash ou WIP, analisar antes de qualquer trabalho novo.

---

**Angular signals: computed() só reage a signals lidos — nunca a propriedades comuns.**

**Why:** Em 2026-04-23, o QuickSearchComponent tinha `query = ''` (string comum) e `filtered = computed(() => ... this.query ...)`. Quando o usuário digitava, `query` mudava, mas o `computed` só re-rodava quando signals lidos mudavam. `filtered()` ficava cacheado com o resultado da primeira avaliação (query vazia → []) e a busca retornava "Nenhum resultado" para tudo. Levou um deploy em prod + screenshot do usuário pra detectar porque não dá pra reproduzir sem digitar e inspecionar.

**How to apply:** Se um valor é lido por `computed()` ou `effect()`, ele **precisa** ser `signal()`. Para `[(ngModel)]="x"` + computed que lê `x`, trocar para `[ngModel]="x()"` e `(ngModelChange)="x.set($event)"`. Também checar: `template` reavalia `computed()` só quando uma dependência signal muda — alterações em propriedades comuns **não invalidam o cache**. Regra: na dúvida, convertar para signal.

---

**Defesa em profundidade multi-tenant: toda query em tabela tenant-scoped precisa de `AND tenant_id = $X` EXPLÍCITO — nunca confiar só em RLS.**

**Why:** 2026-04-23, usuário criou nova conta (`rafaela.noma@hotmail.com`, tenant human) e viu "Amendoim" (animal do tenant `rafaelanoma@hotmail.com`, vet). Investigação provou que RLS em produção está OK (`genomaflow_app` sem BYPASSRLS/SUPERUSER, dados nos tenants corretos). Causa mais provável: JWT antigo em localStorage + ausência de indicador visual de qual tenant o usuário estava logado. MAS a auditoria expôs bugs reais que teriam causado vazamento se RLS falhasse: (1) queries sem filtro explícito de tenant em `patients.js`, `exams.js`, `prescriptions.js` etc., (2) SQL injection em `exams.js:257` via template literal em `SET LOCAL app.tenant_id`, (3) ACL trocada em `feedback.js`/`error-log.js` (checava `role !== 'admin'` mas todo admin de clínica é 'admin' — qualquer admin via feedback de todos os tenants).

**How to apply:** 
1. Toda query SELECT/UPDATE/DELETE em tabela com RLS deve ter `AND tenant_id = $X` explícito — RLS é a última camada, não a única.
2. `set_config('app.tenant_id', $1, true)` SEMPRE parametrizado. Template literal em SQL = proibido (SQL Injection).
3. Endpoints de escopo master (feedback, error-log, tenants) checam `role !== 'master'`, nunca `role !== 'admin'`.
4. UI deve mostrar tenant_name + módulo em local sempre visível (topbar). Incidente mostrou que confusão visual do usuário gera falsos reports de vazamento.
5. Ao navegar para `/onboarding`, limpar sessão ativa (JWT antigo não pode persistir quando se cria novo tenant).
6. Em PR que toca tabela com RLS, revisor deve verificar: filtro explícito de tenant_id + parametrização + teste com dois tenants.
