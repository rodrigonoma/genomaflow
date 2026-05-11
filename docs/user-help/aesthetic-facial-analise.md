# Análise Facial por IA — Guia do Profissional de Estética

> **Módulo:** Estética (`module = estetica`)
> **Namespace RAG:** `product_help`
> **Atualizado em:** 2026-05-11

---

## Como funciona

A análise facial é um recurso de apoio ao profissional de estética. O fluxo completo é:

1. **Registrar consentimento** — Na ficha do cliente, acesse a aba "Análise Facial" e confirme o consentimento do cliente (feito uma única vez por cliente). Sem consentimento registrado, o upload não é liberado.
2. **Enviar a foto** — Faça upload de uma foto seguindo os requisitos abaixo. O sistema valida a imagem antes de aceitar o envio.
3. **Aguardar processamento** — A análise é processada em fila (assíncrona). Você recebe uma notificação via WebSocket quando o resultado estiver pronto. Tempo médio: menos de 60 segundos.
4. **Visualizar resultado** — O resultado exibe as 11 métricas faciais com scores, anotações visuais sobre a foto e recomendações de protocolo.
5. **Comparar evolução** — Para acompanhar o progresso do cliente, use a comparação evolutiva: selecione uma foto anterior como "baseline" e a foto atual. O sistema calcula o delta de cada métrica automaticamente.

---

## Requisitos da foto

Para garantir qualidade de análise, a foto deve atender a todos os critérios abaixo:

| Critério | Especificação |
|---|---|
| **Resolução mínima** | 1024 × 1024 pixels |
| **Formato aceito** | JPEG ou PNG |
| **Tamanho máximo** | 5 MB |
| **Iluminação** | Uniforme e frontal — sem sombras fortes nem contraluz |
| **Posicionamento** | Rosto centralizado, frontal, sem inclinação lateral |
| **Maquiagem** | Sem maquiagem pesada — preferencialmente rosto limpo |
| **Fundo** | Fundo neutro (branco ou cinza) é recomendado |
| **Expressão** | Neutra, boca fechada |

O sistema rejeita automaticamente fotos com rosto não detectado (`NO_FACE_DETECTED`) ou qualidade insuficiente (`IMAGE_TOO_BLURRY`). Nesses casos o crédito é estornado automaticamente.

---

## Como interpretar os resultados

### Métricas disponíveis (11 no total)

Cada métrica apresenta:
- **Score:** valor de 0 a 10, onde 10 representa a condição mais favorável para aquela métrica
- **Observações:** descrição qualitativa gerada pela IA com base no que foi identificado na foto
- **Confiança:** indicador de 0 a 1 que reflete a segurança da IA naquela leitura (valores abaixo de 0,7 merecem atenção especial do profissional)

| Métrica | O que avalia |
|---|---|
| `rugas` | Presença e profundidade de linhas de expressão e rugas |
| `firmeza` | Tônus aparente da pele — ptose e firmeza geral |
| `elasticidade` | Aparência de elasticidade e resiliência da pele |
| `textura` | Regularidade e suavidade da textura superficial |
| `manchas` | Hiperpigmentação, melasma e manchas visíveis |
| `poros` | Dilatação e visibilidade dos poros |
| `olheiras` | Coloração e profundidade da região periorbital |
| `vermelhidao` | Eritema, rosácea e rubor localizado |
| `uniformidade_tom` | Homogeneidade do tom de pele |
| `acne` | Lesões acneicas ativas e cicatrizes recentes |
| `simetria` | Equilíbrio bilateral das estruturas faciais |

### Anotações visuais

A foto exibida no resultado contém anotações visuais (SVG) que indicam as regiões avaliadas. Use a barra de camadas para ativar ou desativar cada tipo de anotação:

- **Bbox** — caixas retangulares delimitando regiões
- **Polyline** — linhas que acompanham contornos
- **Polygon** — polígonos em áreas específicas
- **Line** — indicações lineares (ex: simetria)
- **Point** — pontos de referência anatômica

### Recomendações de protocolo

O segundo agente IA (Opus Recommender) lê as métricas e sugere protocolos estéticos. Essas sugestões são geradas com base nas métricas identificadas e têm caráter exclusivamente informativo — a definição do protocolo é responsabilidade do profissional habilitado.

---

## Comparação evolutiva

1. Na aba "Análise Facial" do cliente, acesse "Comparar evolução"
2. Selecione a análise mais antiga como **baseline**
3. Selecione a análise mais recente como **atual**
4. O sistema calcula o delta de cada métrica (melhora ↑ ou piora ↓) sem nova chamada IA

A comparação é instantânea e útil para demonstrar resultados ao cliente e ajustar protocolos.

---

## Disclaimer regulatório

> **Os resultados desta análise são gerados por inteligência artificial e têm caráter exclusivamente informativo e de apoio ao profissional habilitado. Não constituem diagnóstico médico, laudo clínico nem prescrição de tratamento. A interpretação e a tomada de decisão são de responsabilidade exclusiva do profissional de estética/saúde responsável pelo atendimento, conforme CFM, CFE e CRN.**

---

## FAQ

### Quanto custa uma análise?

Cada análise facial consome **5 créditos** da sua conta. O valor exato em reais depende do pacote de créditos contratado — consulte a seção "Preços" no painel administrativo.

### Preciso de consentimento do cliente?

Sim. O consentimento é **operacional**: você, como profissional responsável, confirma no sistema que o cliente autorizou o uso da foto para análise por IA. Esse registro é feito uma única vez por cliente e fica armazenado com audit log. Sem consentimento, o upload é bloqueado.

### Posso comparar análises de datas diferentes?

Sim. Use a funcionalidade "Comparar evolução" disponível na aba de análise do cliente. Selecione qualquer par de análises realizadas anteriormente — o sistema calcula o delta de cada métrica automaticamente, sem consumir créditos adicionais.

### O que acontece se a foto for rejeitada?

Se a análise falhar por motivo técnico (`NO_FACE_DETECTED`, `IMAGE_TOO_BLURRY`, `BAD_LLM_OUTPUT`), os 5 créditos são **estornados automaticamente**. Você receberá uma notificação com o motivo da falha e poderá tentar novamente com outra foto.

### A IA faz diagnóstico?

Não. A análise é uma ferramenta de apoio ao profissional, não um diagnóstico médico ou laudo clínico. O sistema é calibrado para sugerir — a decisão técnica e clínica é sempre do profissional habilitado.

### As fotos ficam salvas com segurança?

Sim. As fotos são armazenadas com links de acesso temporários (expiram em 1 hora), protegidos por controle de acesso por tenant (RLS). Nenhuma foto é acessível fora da sua clínica. O armazenamento segue as diretrizes da LGPD.

### Quais profissionais podem usar este módulo?

O módulo Estética está disponível para tenants com `module = estetica`. A análise facial pode ser usada por qualquer profissional habilitado da clínica (esteticista, biomédico, etc.). A criação de prescrições médicas continua restrita a médicos e dentistas.

### A análise funciona em qualquer foto?

O sistema exige qualidade mínima: resolução 1024×1024+, rosto frontal, iluminação uniforme, sem maquiagem pesada. Fotos de baixa qualidade são rejeitadas antes mesmo de consumir créditos. Consulte os [Requisitos da foto](#requisitos-da-foto) acima.
