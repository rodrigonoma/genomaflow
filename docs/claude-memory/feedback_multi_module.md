---
name: Compatibilidade multi-módulo obrigatória
description: Todo ajuste, bug ou feature deve funcionar para human e veterinary — nunca quebrar nenhum dos dois
type: feedback
originSessionId: 70201c53-e120-4e84-a6d1-e96d8946598d
---
Todo desenvolvimento deve ser validado para os módulos `human` e `veterinary`.

**Why:** Os dois módulos têm mundos diferentes (agentes, terminologia, campos, espécies) mas coexistem na mesma plataforma. Uma mudança que funciona só para um pode silenciosamente quebrar o outro.

**How to apply:**
- Ao implementar qualquer mudança, perguntar: "isso funciona para human E veterinary?"
- Se a solução correta para um módulo não for óbvia, questionar o usuário antes de prosseguir — nunca assumir
- Nenhum ajuste pode causar regressão em funcionalidade pré-existente de nenhum módulo
- Diferenças-chave: veterinary tem Owner, espécies, agentes small_animals/equine/bovine, sem clinical_correlation; human tem especialidade médica do usuário, agentes metabolic/cardiovascular/hematology, com clinical_correlation
