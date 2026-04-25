# Anexar Análise de IA no Chat entre Clínicas

Você pode compartilhar com outra clínica a **interpretação que os agentes de IA fizeram** de um exame, sem expor dados pessoais do paciente. A plataforma anonimiza automaticamente o snapshot antes do envio.

## Como anexar

1. Em uma conversa, clique no ícone **anexo** (insights) e escolha **Análise IA**.
2. Selecione um **exame finalizado** da sua clínica.
3. Escolha quais **agentes** quer incluir (ex: Cardiovascular, Hematologia, Nutrição).
4. O snapshot anonimizado é montado e enviado como **cartão visual** dentro da conversa.

## O que vai junto

O cartão contém apenas o que é clinicamente relevante para discussão:

- **Tipo de exame** e modalidade (ex: ECG de 12 derivações, Hemograma completo, RM de joelho).
- **Faixa etária** do paciente em **bucket de 10 anos** (ex: 30–39 anos, não a idade exata).
- **Sexo** do paciente.
- **Espécie e raça** (módulo veterinário).
- **Interpretação** de cada agente de IA escolhido.
- **Pontuações de risco** calculadas pelos agentes.
- **Alertas** clínicos identificados.
- **Recomendações** geradas.

## O que **não** vai

A anonimização remove obrigatoriamente:

- Nome do paciente
- CPF / RG (módulo humano)
- Telefone, e-mail, endereço
- Microchip e nome do animal (módulo veterinário)
- Data de nascimento exata
- Foto ou imagem identificável
- Identificadores internos do paciente (id na clínica, prontuário)

A faixa etária em bucket de 10 anos garante que casos isolados não sejam reidentificáveis pela combinação "idade exata + condição rara".

## Quando usar

- **Segunda opinião**: você quer que outro especialista veja o que a IA da plataforma interpretou e dê opinião própria.
- **Discussão de caso atípico**: o resultado da IA chamou atenção e você quer validar com colega de outra clínica.
- **Treinamento**: discutir uma análise interessante para fins didáticos com clínica parceira.

## O que a clínica destinatária vê

- Um **cartão visual** dentro da conversa com o resumo da análise, organizado por agente de IA.
- A clínica destinatária **não pode**:
  - Reprocessar o exame
  - Acessar o PDF/imagem original do exame
  - Ver dados de identificação
  - Consumir créditos da clínica de origem

A análise é um **snapshot estático** — se a clínica de origem refizer a análise depois, o cartão antigo permanece como estava no momento do envio.

## Combinando com texto livre

Você pode (e deve) acompanhar o cartão com uma mensagem de texto explicando o que está perguntando. O cartão sozinho fornece os dados clínicos; o texto fornece o contexto da pergunta. Exemplo:

> "Olá, anexei uma análise cardiovascular da IA daqui que ficou de risco moderado. O paciente apresenta sintomas há 3 meses mas o ECG está limpo. O que sua experiência sugere?"

## Limites

- Apenas **exames com status concluído** (`done`) podem ser anexados. Exames em processamento ou com falha não aparecem na seleção.
- Apenas exames da **sua própria clínica** — não dá para anexar análise de exame de outra clínica.
- Você precisa selecionar **pelo menos um agente** para gerar o cartão. Se nenhum agente daquele exame respondeu (todos falharam), o cartão não pode ser montado.
