# Catálogo de Tratamentos Estéticos — Guia do Profissional

> **Módulo:** Estética (`module = estetica`)
> **Namespace RAG:** `product_help`
> **Atualizado em:** 2026-05-12

---

## Como funciona

O catálogo é a base de conhecimento que conecta as métricas detectadas pela IA com tratamentos reais — sessões recomendadas, intervalo entre elas, custo estimado, indicações e contraindicações.

Existem duas camadas:

1. **Catálogo global GenomaFlow** — Curado pela administração. Cobre os ~22 tratamentos mais comuns no mercado brasileiro (Toxina Botulínica, HIFU, Microagulhamento, Radiofrequência, Peelings, etc.). Visível para todas as clínicas.
2. **Catálogo proprietário do tenant** — Você (admin/master da clínica) pode adicionar tratamentos exclusivos da sua clínica. Só sua clínica enxerga esses.

Ao gerar um protocolo, a IA escolhe APENAS entre os tratamentos disponíveis (global + proprietário) — não inventa procedimentos. Se o nome retornado for desconhecido, o sistema marca como "Em breve catálogo".

---

## O que a IA faz com o catálogo

Quando uma análise é processada:

1. **Worker recommender** recebe a lista de tratamentos disponíveis no prompt.
2. Opus IA escolhe os mais adequados às métricas detectadas, considerando o profissional logado (esteticista vs. médico).
3. **Pós-LLM**, o sistema faz match do nome retornado com o catálogo via:
   - **Normalização** — remove acentos, lowercase, trim, colapsa espaços
   - **Synonyms map** — ~30 brand→generic mappings BR (Botox/Dysport→Toxina Botulínica, Morpheus8→RF Microagulhada, Sculptra→Bioestimulador, Ultraformer→HIFU Facial, IPL→Luz Pulsada, CoolSculpting→Criolipólise, etc.)
4. **Match encontrado** → cartão exibe nome canônico, sessões/intervalo/custo do catálogo + `requires_medico` (sobrescreve LLM por segurança).
5. **Match não encontrado** → cartão mostra "Em breve catálogo" + botão Agendar desabilitado (até o admin promover essa sugestão a tratamento oficial).

---

## Adicionar tratamento proprietário

Como admin/master da clínica:

1. Acesse `/master/aesthetic-catalog`
2. Clique "Novo tratamento"
3. Preencha: nome, categoria, indicações (comma-separated), contraindicações, sessões típicas, intervalo (dias), custo min/max BRL, evidência (A/B/C/D), descrição, notas de protocolo, "requires_medico"
4. Salve. O tratamento fica visível APENAS para sua clínica.

Para editar/desativar: mesma tela. Delete é soft (`is_active=false`).

---

## Job mensal de descoberta de novos tratamentos

Uma vez por mês (dia 1 às 03:00 UTC), o sistema dispara um job que pergunta à IA:
> "Liste 10-20 tratamentos estéticos surgidos ou popularizados no Brasil nos últimos 6 meses, excluindo os já no catálogo."

Os resultados entram em uma **fila de revisão** que o master vê em `/master/aesthetic-suggestions`:
- **Aprovar** — Promove para o catálogo global (todas as clínicas passam a ver).
- **Rejeitar** — Descarta com motivo.
- **Vincular existente** — Marca como duplicado de tratamento já no catálogo (alias).

Isso garante que o catálogo evolui sem virar bagunça: cada entrada tem revisão humana.

---

## Categorias do catálogo

`corpo_modelagem`, `corpo_flacidez`, `facial_rejuvenescimento`, `facial_pigmentacao`, `facial_acne`, `facial_preenchimento`, `facial_toxina`, `cabelo`, `procedimento_cirurgico`, `wellness_drenagem`, `outro`.

---

## FAQ

### Posso usar tratamentos que não estão no catálogo?

Pode realizar o procedimento na clínica — mas o sistema NÃO recomenda automaticamente nem agenda séries para tratamentos fora do catálogo. Adicione como proprietário para que apareça nas sugestões da IA.

### O catálogo global recebe atualizações automáticas?

Sim — o job mensal sugere novos tratamentos. Mas as adições passam por revisão master antes de virarem oficiais. Você verá tratamentos novos chegando aproximadamente uma vez por mês.

### A IA pode sugerir tratamentos que exigem médico mesmo para esteticista?

Não. O recommender filtra `requires_medico=true` quando o profissional logado é esteticista (sem CRM). O catálogo determina esse atributo — não a IA.

### Posso editar tratamentos do catálogo global?

Não. Apenas tratamentos do seu próprio tenant. Para sugerir mudança em entry global, use o canal de feedback com a administração GenomaFlow.

### Como funciona o "Em breve catálogo"?

Indica que a IA sugeriu um tratamento cujo nome ainda não está catalogado. Pode ser uma novidade no mercado ou variação de nomenclatura. O master pode aprovar essa sugestão na próxima revisão mensal para que vire um item oficial.

### O custo estimado é fixo?

Não — é uma faixa baseada em pesquisa de mercado BR 2026. Sua clínica define o preço final. A faixa serve apenas para informar o cliente durante a sugestão de protocolo.
