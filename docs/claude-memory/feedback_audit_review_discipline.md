---
name: Disciplina de revisão de auditoria — auditor pode errar
description: Toda recomendação de auditor (humano ou agente Explore) DEVE ser verificada lendo o código real antes de virar PR. Auditor já errou múltiplas vezes em uma única auditoria (2026-05-10) — output de LLM nunca confiável
type: feedback
---

Toda recomendação vinda de auditoria (humana ou de agente Explore subagent) DEVE ser verificada lendo o código real EM CONTEXTO antes de virar PR. Auditor erra com frequência.

**Why:** Na auditoria 360° de 2026-05-10 (6 agentes paralelos), foram identificados **5 falsos positivos** entre os achados — sendo um deles **catastrófico se aplicado cego** (PR11 — auditor sugeriu trocar `role !== 'admin'` por `role === 'master'` em 5 rotas; código real já tinha `role !== 'admin' && role !== 'master'`; aplicar cego bloquearia todos os admins de clínica em prod).

Os falsos positivos vieram de:
- Snippet lido fora de contexto (PR11 ACL — só leu a primeira condição, ignorou `&& role !== 'master'`)
- "SQL injection via column name" em conversations.js — auditor mesmo concluiu "SEGURO" mas listou no relatório
- `console.log` em master.js já removido antes da auditoria
- `chat.js:100` embedding "via string interpolation" — já estava parametrizado via `$1::vector`
- "Missing auth em /tenants/:id/users" — auditor mesmo flagou como "falso alarme"

LLM-as-a-judge alucina, lê snippet sem contexto, repete padrões que parecem com bugs conhecidos. Confiar cego é como aplicar `git push --force` por fé.

**How to apply:**

1. **Antes de criar PR baseado em achado de auditoria, LER o arquivo real** no estado atual da main. Não confiar no snippet do relatório. Especialmente:
   - Condições compostas (`&&`, `||`) — auditor frequentemente vê só uma metade
   - Linhas com guard clauses + decisão em outro lugar (early return + lógica depois)
   - Patterns que MUDARAM no commit recente (auditor pode ter lido versão antiga indexada)

2. **Para CADA recomendação, perguntar 3 coisas antes de implementar:**
   - O código realmente faz o que o auditor descreveu? (Reler em contexto)
   - Se eu aplicar o fix, o que o usuário legítimo perde? (Mapeie impacto)
   - Existe um teste que confirma o bug? (Reproduzir, se possível)

3. **Apresentar diff DO CÓDIGO REAL pro usuário antes de PR:**
   - Não basta dizer "auditor flagou X em arquivo Y"
   - Mostrar as linhas reais (não as do relatório)
   - Pedir confirmação se a interpretação faz sentido

4. **Quando o usuário pedir uma PR específica baseada em achado de auditoria:**
   - Investigar primeiro
   - Se virou falso positivo, **explicar pro usuário** com código real e CANCELAR a PR (igual ao PR11 em 2026-05-11)
   - Não inventar uma "alternativa" pra justificar o trabalho — falso positivo é falso positivo, fim

5. **Registrar falsos positivos em memória** pra que próximas sessões / próximos agentes saibam:
   - Quais achados eram falsos
   - O que confundiu o auditor
   - Como o código real diferia do snippet do relatório

6. **Padrões conhecidos de falso positivo deste codebase:**
   - ACL `role !== 'admin' && role !== 'master'` é o **padrão correto** pra admin-of-tenant. Auditor que disser "use master apenas" provavelmente leu metade da condição.
   - Vector strings (`[${embedding.join(',')}]`) são seguras quando passadas como `$1::vector` parametrizado — números do OpenAI não contêm chars especiais.
   - `console.log` em routes de master pode ser debug temporário JÁ REMOVIDO em commit posterior — verificar git log antes de apontar.
   - Tabelas listadas como "sem RLS" podem ser intencionais (`rag_documents`, `device_tokens` per design) — checar memória `feedback_red_flags.md` antes.

**Não fazer:**
- Aplicar recomendação de auditor sem reler o código (regra de "sem gambiarra")
- Acreditar que "se o auditor flagou, deve ter algo"
- Criar PR baseado em achado sem confirmação do código real
- Forçar uma correção quando o achado se prova falso positivo
