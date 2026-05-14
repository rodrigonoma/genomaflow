---
name: Sempre ativar Monitor em deploys
description: Toda vez que disparar um deploy (CI deploy.yml, cdk deploy, ou qualquer pipeline longo), ativar a tool Monitor pra acompanhar status em tempo real
type: feedback
---

Sempre que disparar um deploy (push pra main que aciona deploy.yml, `cdk deploy`, ou qualquer pipeline longo), **ativar a ferramenta Monitor** pra acompanhar status em tempo real.

**Why:** O usuário precisa saber quando o deploy progride, falha ou completa sem ter que perguntar. CLAUDE.md já tem "Monitor obrigatório após todo push" — esta regra reforça e estende: vale também pra `cdk deploy`, jobs ECS one-shot e qualquer comando >2min cuja saída interessa em tempo real. Sem Monitor, o usuário fica no escuro até eu lembrar de checar manualmente.

**How to apply:**

### CI deploy.yml (`gh run watch` ou poll `gh run list`)

```bash
# Quick: foreground + bloqueia até terminar
gh run watch <run_id> --exit-status

# Background com Monitor: polling com filtro de transições terminais
prev=""
while true; do
  s=$(gh run view <run_id> --json status,conclusion,jobs)
  cur=$(jq -r '.jobs[] | "\(.name): \(.conclusion // .status)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev=$cur
  jq -e '.status == "completed"' <<<"$s" >/dev/null && break
  sleep 30
done
```

### `cdk deploy` (tail do log de background bash)

```bash
# Background bash output file está em $TMPDIR/...output
# Filtrar pelas transições importantes
tail -F /caminho/output | grep -E --line-buffered "✅|✨|❌|Error|FAILED|deploying|Resources|complete|CREATE_COMPLETE|UPDATE_COMPLETE|CREATE_FAILED|UPDATE_FAILED|ROLLBACK"
```

### Princípios do Monitor (vide skill)

- **Cobertura completa de estados terminais** — filtro deve pegar succeed E fail. Silêncio não é sucesso.
- **`grep --line-buffered`** sempre em pipes (sem isso, eventos atrasam minutos).
- **Intervalo de poll:** 30s+ pra APIs remotas, 0.5-1s pra arquivo local.
- **Descrição específica** ("CDK deploy genomaflow-rds Multi-AZ" não "deploy").

### Quando NÃO usar Monitor

- Comandos rápidos (<30s) — Bash síncrono basta
- Comandos que já bloqueiam e exitam quando terminam (`gh run watch` em foreground) — Bash com timeout maior
- Quando só preciso UMA notificação ao final → `Bash run_in_background` (notificação automática quando processo exita)

### Pós-deploy

Sempre confirmar resultado final concreto (não apenas "concluído"):
- `gh run view <id> --json conclusion` → success/failure
- `aws cloudformation describe-stacks --stack-name <nome>` → CREATE_COMPLETE/UPDATE_COMPLETE
- Smoke test em prod (login, telas críticas) quando mudança afeta runtime
