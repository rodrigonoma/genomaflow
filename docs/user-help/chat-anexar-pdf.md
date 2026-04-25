# Anexar PDF no Chat entre Clínicas

PDFs anexados ao chat passam por uma análise automática que **cobre dados pessoais** com retângulos pretos antes do envio. O comportamento depende do tipo de PDF.

## Como anexar

1. Em uma conversa, clique no ícone **anexo** (clipe) e escolha **PDF**.
2. Selecione o arquivo (até 10MB).
3. Aguarde a análise — leva entre 1 e 5 segundos para PDFs típicos.
4. A plataforma identifica o tipo de PDF e segue um dos dois caminhos abaixo.

## Caminho 1 — PDF digital (com texto extraível)

A grande maioria dos PDFs gerados por sistemas de laboratório, prontuário eletrônico ou aplicativos de hospital se encaixa aqui.

### O que acontece

- O sistema detecta texto e posições de cada palavra dentro do PDF.
- Identifica **automaticamente** os seguintes tipos de dado pessoal:
  - **Nome próprio** de pessoa ou de pet
  - **CPF**
  - **CNPJ**
  - **RG**
  - **Telefone** (com ou sem DDD)
  - **E-mail**
  - **CEP**
  - **Datas** (formato DD/MM/AAAA)
- Cobre cada ocorrência com um **retângulo preto** sobre o texto, mantendo o restante do PDF intacto (mesmo layout, mesmo tamanho, qualidade idêntica).

### Tela de preview

Antes do envio, abre uma janela com:

- **Resumo do que foi detectado** — chips coloridos como "3 nomes · 1 CPF · 2 telefones".
- **Visualização do PDF redigido** dentro da própria janela — você pode rolar e conferir cada página.
- **Link "Ver PDF original em nova aba"** — abre o PDF sem redação para conferência rápida.
- **Caixa de confirmação** — você precisa marcar "Confirmo que revisei e o PDF redigido está adequado para envio" antes de poder enviar.

Se nenhum dado pessoal for detectado, o PDF é enviado **direto**, sem essa tela (não há nada a revisar).

### Limites e cuidados

- A redação automática é **conservadora**: em caso de dúvida, o sistema **não** marca como dado pessoal. Termos médicos comuns (T1, T2, FLAIR, ACL, AVC, RM, TC, ECG etc.) **nunca** são marcados.
- O **texto continua existindo na camada de texto do PDF**, apenas oculto pelos retângulos pretos. Pessoas com ferramentas avançadas podem extrair o texto coberto. Trate o resultado como "ofuscado", não como "criptografado".
- Se identificar algo que escapou da detecção automática, **cancele o envio** e remova o dado na origem (no sistema que gerou o PDF) antes de tentar de novo.

## Caminho 2 — PDF escaneado (imagem sem texto)

PDFs gerados por scanner de papel, foto de documento ou exportação como imagem caem aqui.

### O que acontece

- O sistema detecta que **não há camada de texto** suficiente.
- A redação automática **não é possível** sem OCR pesado, que desviaria do tempo aceitável de envio.
- Abre uma janela de aviso explicando a situação.

### Tela de aviso LGPD

A janela informa que:

- O PDF parece ser **escaneado**.
- A LGPD proíbe compartilhar dados pessoais sem consentimento adequado e medidas técnicas de proteção.
- Antes de enviar, você precisa confirmar que **uma das duas condições** abaixo é verdadeira:
  - O documento **não contém** nenhum dado pessoal identificável (nome, CPF, microchip etc.);
  - **Ou** você tem **consentimento expresso** do titular para compartilhar com a clínica destinatária no contexto de cuidado em saúde.
- Você marca uma caixa assumindo a **responsabilidade exclusiva** pelo envio.
- O botão **Enviar mesmo assim** só fica disponível depois da marcação.

### Quando esse fluxo aparece

- Você fotografou ou escaneou um documento físico.
- O PDF é resultado de OCR antigo que não preservou texto.
- O PDF é uma exportação de imagem (PNG/JPG embrulhado em PDF).

### Recomendação

Se possível, **gere o PDF a partir da fonte digital** (sistema do laboratório, exportação direta) em vez de escanear o impresso. Você economiza tempo e ganha a redação automática.

## Tamanho e desempenho

- **Tamanho de saída**: o PDF redigido tem o **mesmo tamanho** do original — a plataforma desenha retângulos por cima, sem rasterizar nem reprocessar a imagem.
- **Tempo de processamento**: 1 a 3 segundos para PDFs digitais típicos (até 10 páginas). Para PDFs escaneados, é instantâneo (não há análise).
- **Após o envio**: o PDF redigido fica disponível para download na conversa por meio de um link assinado, válido por 1 hora a cada clique.

## Onde a clínica destinatária vê o PDF

- Na conversa, aparece um cartão com o nome do arquivo, tamanho e botão **Baixar**.
- O download abre o **PDF redigido** (com os retângulos pretos), nunca o original.
- O original fica armazenado temporariamente para fins de auditoria interna; a clínica destinatária **não tem acesso** a ele.

## Erros comuns

- **"PDF excede 10MB"** — divida o documento em partes ou comprima.
- **"Falha ao analisar o PDF"** — pode ser PDF criptografado/protegido por senha. Remova a proteção e tente de novo.
- **"PDF contém dados pessoais — remova antes de anexar"** — só ocorre num caminho legado. Se aparecer, refaça a operação para que o sistema redija automaticamente.
