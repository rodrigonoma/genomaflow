---
name: Sem regressão e sem gambiarra
description: Regra inviolável — toda feature, ajuste ou correção de bug deve ser entregue sem quebrar funcionalidade existente, com melhores práticas e técnicas adequadas, jamais com gambiarra
type: feedback
---

Toda feature nova, ajuste ou correção de bug DEVE ser entregue sem quebrar nada da aplicação E utilizando as melhores práticas/técnicas. Gambiarra é proibida.

**Why:** Regressão silenciosa em sistema clínico multi-tenant em produção tem impacto direto em médicos atendendo pacientes — qualquer fluxo quebrado (login, agenda, prontuário, prescrição, exame, vídeo) é incidente real. Gambiarra acumula dívida técnica que cobra juros (cada workaround dificulta o próximo fix, mascara causa raiz e gera regressões em cascata). O usuário exige nível sênior em todas as 6 dimensões (código, arquitetura, produto, UX, dados, banco) — atalho que parece "rápido" hoje quase sempre custa mais caro depois.

**How to apply:**

### Sem regressão (não quebrar nada)

1. **Mapear impacto antes de tocar:** antes de qualquer mudança, identificar TODOS os pontos do código que dependem do que vai mudar (`Grep` por símbolo, callers, schema, rotas, testes). Listar e considerar cada um.
2. **Multi-módulo (human + veterinary + estetica):** toda mudança precisa funcionar nos três módulos. Se a implementação correta para um deles não for óbvia, perguntar antes de prosseguir.
3. **Smoke test obrigatório antes de pedir aprovação:** subir Docker, fazer login admin + login master, abrir telas críticas (dashboard, agenda, paciente, exame, prescrição, chat, vídeo) — verificar que o que estava funcionando continua funcionando. Não basta validar a tela alterada.
4. **Rodar `npm run test:unit` (api), `npm test` (worker/web) localmente** antes de pedir aprovação. Falha local = não pedir aprovação.
5. **Defesa em profundidade preservada:** `AND tenant_id = $X` explícito, `withTenant({ userId, channel })`, RLS, ACL `role !== 'master'` em master endpoints — nunca remover/relaxar nenhuma camada existente "pra simplificar".
6. **Migrations sempre aditivas:** `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` com lista estendida; `ADD COLUMN` com default seguro; jamais `DROP COLUMN`/`DROP TABLE` sem plano de dados explícito e aprovação.
7. **Sync mobile obrigatório** após mudança em `apps/web/` — feature na web sem `npx cap sync android` quebra paridade.
8. **Se algo não puder ser testado, declarar explicitamente** ao pedir aprovação. Nunca dizer "funciona" sem ter verificado.

### Sem gambiarra (melhores práticas e técnicas)

1. **Causa raiz, sempre.** Nunca corrigir sintoma sem entender a causa. Vibe coding é proibido (`feedback_code_editing_rules.md`).
2. **Padrões consagrados do projeto vencem improvisos.** Antes de inventar abordagem nova, procurar como o projeto já resolve problema parecido (`Grep` + leitura). Replicar o pattern existente.
3. **SDK/lib oficial vence solução caseira.** Não reescrever o que já tem biblioteca testada (parsing, crypto, validação, dates). Sempre verificar assinatura do SDK antes de usar.
4. **Tipagem forte, validação na entrada.** Whitelist de enums, parametrização de SQL, saneamento de output do LLM (regex JSON, clamp, slice, `BAD_LLM_OUTPUT 502`). Nunca confiar cegamente em input externo nem em output de IA.
5. **Idempotência onde a operação pode repetir.** UPSERT, `ON CONFLICT`, UNIQUE INDEX partial — pattern já estabelecido em `scheduled_notifications`, `ai_suggestions`. Reusar.
6. **Erros explícitos com código + status correto** (`BAD_LLM_OUTPUT`, `OVERLAP`, `INPUT_TOO_SHORT`). Nunca `try/catch` mudo nem `console.log` em prod.
7. **Sem `console.log` ou flags de debug em código de produção.** Logger estruturado quando necessário; remover qualquer debug antes de pedir aprovação.
8. **Sem comentário "TODO: arrumar depois"** sem issue/spec correspondente. Dívida invisível é dívida que cresce.
9. **Sem hack pra contornar ferramenta** (skip de teste, `--no-verify`, bypass de RLS, hardcode de tenant_id, env var injetada manualmente em prod). Se a ferramenta está atrapalhando, investigar a causa — nunca burlar.
10. **Sem código duplicado por preguiça de refatorar.** Se três usos do mesmo pattern aparecerem, extrair helper/service. Mas sem premature abstraction — só refatorar quando o terceiro caso aparece.
11. **Sem `Write` em arquivo existente** (apaga conteúdo não-lido); sem `git stash` (perde código); uma concern por branch.

### Sinal de alerta — pare e pense de novo

Se uma das frases abaixo aparecer no raciocínio, é red flag de gambiarra:

- "Por enquanto, vou só…" → não há "por enquanto" em prod, é definitivo até alguém voltar pra arrumar (ninguém volta).
- "É um quick fix, depois eu refatoro" → o "depois" não chega; vira regra do projeto.
- "Funciona aqui, deve funcionar lá" → testar lá antes de afirmar.
- "Vou ignorar esse erro/teste por agora" → o erro/teste está dizendo algo; ouvir.
- "Vou copiar e colar e adaptar" → extrair função compartilhada.
- "RLS já cobre isso, não preciso filtrar tenant_id" → RLS é a última camada, não a única.

### Trade-off documentado

Quando uma decisão for legitimamente um trade-off (não gambiarra), explicitar no commit/PR/memória qual a alternativa considerada e por que foi descartada. Memória do projeto tem padrões disso: `project_audit_log.md` (Option B vs A), Phase 4 (foso defensável vs ERP fiscal), `feedback_pdf_redaction_strategy.md` (rasterização descartada).
