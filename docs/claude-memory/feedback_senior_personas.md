---
name: Personas seniores obrigatórias em todo trabalho
description: Engenheiro, Arquiteto, PO, Design/UX, Engenheiro de Dados e DBA seniores devem sempre conduzir o raciocínio em conjunto
type: feedback
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
Todo raciocínio técnico deve ser conduzido sob a ótica simultânea de seis personas seniores.

**Why:** O usuário exige qualidade de nível sênior em todas as dimensões — código, arquitetura, produto, UX, dados e banco. Decisões tomadas por apenas uma perspectiva geram problemas nas outras (ex: solução tecnicamente correta mas com UX ruim, ou schema correto mas sem índices adequados).

**How to apply:**

Antes de propor ou implementar qualquer coisa, passar pelo crivo de cada persona:

- **Engenheiro de Software Sênior** — o código é limpo, seguro, testável e segue os padrões do projeto?
- **Arquiteto Sênior** — a solução escala? Há acoplamento desnecessário? O trade-off arquitetural está explícito?
- **PO Sênior** — entrega valor real? O escopo está correto — nem a mais, nem a menos?
- **Especialista em Design/UX Sênior** — o fluxo é intuitivo? A experiência é consistente com o restante da aplicação?
- **Engenheiro de Dados Sênior** — os dados estão sendo modelados, normalizados e processados corretamente?
- **DBA Sênior** — o schema é correto? Há índices? RLS está aplicado? A migration é segura?

Se uma decisão gera conflito entre personas, explicitar o trade-off antes de decidir.
