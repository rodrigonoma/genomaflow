# Perfil Nutricional & Antropométrico — Guia do Profissional de Estética

> **Módulo:** Estética (`module = estetica`)
> **Namespace RAG:** `product_help`
> **Atualizado em:** 2026-05-12

---

## Como funciona

A aba "Perfil Estético" na ficha do cliente armazena dados antropométricos + objetivos. O sistema calcula automaticamente TMB (Taxa Metabólica Basal), calorias diárias e macros sugeridos pela fórmula **Mifflin-St Jeor** — gold standard para adultos.

Esses valores alimentam a IA durante as análises: o agente Opus recebe os números pré-calculados e responde com sugestões de alimentação e estilo de vida personalizadas, com **disclaimer obrigatório de nutricionista (CRN)**.

---

## Campos do perfil

| Campo | Faixa padrão | Faixa estendida (allow_extreme_ranges) |
|---|---|---|
| Altura (cm) | 140-220 | 100-230 |
| Peso (kg) | 35-200 | 25-300 |
| Idade (anos) | 12-100 | 5-110 |
| Sexo | F / M | igual |
| Nível de atividade | sedentary, light, moderate, active, very_active | igual |
| Objetivos | fat_loss, tone, wellness, mass (até 5) | igual |
| Alergias | até 20 itens texto | igual |
| Condições médicas | até 20 itens texto | igual |
| Restrições alimentares | vegetariano, vegano, lactose, glúten, low_carb, low_sodium, diabético | igual |

A flag `allow_extreme_ranges=true` é necessária para registrar casos atípicos (atletas de elite, crianças, idosos com obesidade). Quando ativada, o sistema retorna **warnings PT-BR** explicando que TMB Mifflin-St Jeor é otimizado para adultos.

---

## Fórmula de cálculo

**Mifflin-St Jeor BMR:**
- Homem: TMB = 10·peso + 6.25·altura − 5·idade + 5
- Mulher: TMB = 10·peso + 6.25·altura − 5·idade − 161

**Fator de atividade:**
- Sedentário: 1.20
- Leve (1-3h/sem): 1.375
- Moderado (3-5h/sem): 1.55
- Ativo (6-7h/sem): 1.725
- Muito ativo (>7h/sem): 1.90

**Ajuste por objetivo:**
- Perda de gordura (fat_loss): 0.80 (déficit 20%)
- Tonificação (tone): 0.95 (déficit 5%)
- Bem-estar (wellness): 1.00 (manutenção)
- Ganho de massa (mass): 1.10 (superávit 10%)

**Macros (% das calorias):**
- fat_loss / tone: 30P / 40C / 30F
- wellness: 25P / 45C / 30F
- mass: 25P / 50C / 25F

**Hidratação sugerida:** 35ml × peso_kg, clamp 1500-4000 ml/dia.

**Exercício:** clamp 0-180 min/dia, ajustado pelo objetivo.

---

## Histórico de mudanças

Toda alteração do perfil fica registrada no audit_log. O profissional pode visualizar a cronologia via botão "Ver histórico de mudanças" no painel do perfil:

- Quem mudou (e-mail)
- Quando (data + hora)
- Diff dos campos (ex: "weight_kg: 65 → 67")

Útil para acompanhar evolução do cliente ao longo do tempo.

---

## Como a IA usa o perfil

Durante a análise estética (facial ou corporal), o worker:

1. Lê o `aesthetic_profile` do cliente.
2. Calcula TMB/calorias/macros **server-side** (não delega ao LLM — aritmética crítica regulatória).
3. Injeta os números no prompt: *"Use EXATAMENTE estes valores: TMB X kcal, calorias Y kcal/dia, P/C/F gramas. NÃO recalcule."*
4. Opus responde com:
   - Alimentos sugeridos (`to_emphasize`)
   - Alimentos a reduzir (`to_minimize`)
   - Sugestão de hidratação + exercício
   - **Disclaimer CRN obrigatório**

Se o cliente não tem perfil preenchido, a análise prossegue normalmente — mas sem orientações nutricionais.

---

## Disclaimer regulatório

> **Os cálculos de TMB, calorias e macros são estimativas baseadas em Mifflin-St Jeor. Orientações de alimentação e estilo de vida geradas pela IA são complementares e NÃO substituem consulta com nutricionista (CRN). A definição de plano alimentar terapêutico é responsabilidade exclusiva de profissional habilitado.**

Esse disclaimer aparece em todo painel de "Recomendações de Estilo de Vida" e é **injetado automaticamente** pelo backend mesmo se a IA esquecer de incluí-lo — fail-safe regulatório.

---

## FAQ

### Posso preencher só alguns campos?

Sim. O sistema calcula TMB/calorias apenas quando todos os 4 campos antropométricos básicos estão preenchidos (altura, peso, idade, sexo). Os demais (objetivos, alergias, restrições) refinam o cálculo e a sugestão da IA mas são opcionais.

### A IA gera plano alimentar?

Não. A IA gera **orientações qualitativas** (alimentos a priorizar / reduzir). Plano alimentar terapêutico exige consulta com nutricionista habilitado pelo CRN.

### Por que TMB não funciona para crianças?

Mifflin-St Jeor é otimizado para adultos (≥18 anos). Para pediátricos, fórmulas como Schofield ou Cunningham são mais apropriadas. Se usar a flag `allow_extreme_ranges` para idade <12, o sistema mostra warning — você pode prosseguir mas com ciência da limitação.

### O perfil é compartilhado com outras análises?

Sim — todas as análises futuras do mesmo cliente usam o perfil mais recente. Atualize sempre que houver mudança significativa (peso, condições médicas, objetivos).

### Sou esteticista, posso definir plano alimentar?

A plataforma respeita seus limites profissionais — sugere orientações gerais com disclaimer CRN. A prescrição de plano terapêutico continua sendo competência exclusiva do nutricionista.
