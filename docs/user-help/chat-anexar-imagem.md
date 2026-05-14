# Anexar Imagem no Chat entre Clínicas

Imagens (PNG ou JPEG) anexadas ao chat passam por um **editor visual de redação** antes do envio. O administrador desenha retângulos pretos sobre dados pessoais visíveis e confirma manualmente que a imagem final está adequada.

## Como anexar

1. Em uma conversa, clique no ícone **anexo** (clipe) e escolha **Imagem**.
2. Selecione o arquivo (PNG ou JPEG, até 10MB).
3. Aguarde a análise — leva entre 5 e 15 segundos.
4. O **editor visual** abre.

## Editor visual

A janela mostra:

- A **imagem original** em uma área de canvas.
- **Retângulos vermelhos** indicando trechos onde o sistema identificou texto suspeito (nome, número de documento, telefone etc.) — propostas de redação automática.
- **Estatísticas** no rodapé: quantos blocos foram detectados automaticamente, quantos você adicionou manualmente, quantos removeu.
- Uma caixa de **confirmação obrigatória** antes de enviar.

### O que você pode fazer

- **Clique e arraste** sobre qualquer área da imagem para criar um novo retângulo de redação manual (aparece em **azul**).
- **Clique em cima** de um retângulo para removê-lo (se for automático, vira tracejado cinza indicando "não será aplicado"; se for manual, é apagado).
- Volte a clicar em um retângulo automático removido para restaurá-lo.
- O canvas suporta scroll para imagens grandes — você pode revisar cada região com calma.

### Antes de enviar

- Marque a caixa **"Confirmo que revisei e a imagem final não contém dados pessoais identificáveis"**.
- O botão **Enviar imagem** só fica disponível depois da marcação.

## Detecção automática

A plataforma usa OCR + classificador para identificar automaticamente:

- **Nome próprio** de pessoa ou pet
- **CPF, CNPJ, RG**
- **Telefone, e-mail, CEP**
- **Datas** (DD/MM/AAAA)
- **Microchip** (sequência numérica longa)

A detecção é **conservadora**: termos médicos (T1, T2, AX, FLAIR, ACL, AVC, RM, TC, ECG etc.), tipos de exame, marcas de aparelho e diagnósticos **nunca** são marcados, mesmo que pareçam siglas ou nomes.

Se nenhum bloco for detectado automaticamente, aparece um aviso pedindo para você desenhar manualmente sobre qualquer dado visível.

## Formato e tamanho de saída

A imagem enviada é convertida para **JPEG com qualidade 85** — formato comprimido que mantém legibilidade clínica e reduz o tamanho do arquivo em até 10x em comparação ao PNG original.

Implicações práticas:

- Upload mais rápido (3MB vira ~300KB).
- Menor consumo de armazenamento e largura de banda.
- Não recomendado para imagens com **transparência crítica** ou **screenshots de UI** — para esses casos, prefira anexar como PDF.

## Onde a clínica destinatária vê

- Na conversa, aparece um **cartão com a miniatura** da imagem.
- Clicar abre a imagem **redigida** em tamanho cheio.
- A imagem original (sem redação) **não fica acessível** para a clínica destinatária — a plataforma armazena apenas a versão redigida no destino final.

## Boas práticas

- Antes de anexar, considere se a **imagem como um todo** é necessária ou se um trecho recortado já resolve. Cortar antes de subir reduz risco de PII esquecida.
- Para exames de imagem (RX, RM, TC, US, ECG): conferir cabeçalhos do laudo, etiquetas de identificação do paciente, marcas d'água do equipamento. Esses são os locais comuns onde aparece nome.
- Para fotos clínicas (lesão, ferida etc.): atenção a tatuagens, joias com inscrições, plano de fundo com documentos visíveis.

## Erros comuns

- **"Imagem excede 10MB"** — reduza a resolução antes de subir.
- **"Apenas PNG ou JPG"** — outros formatos (HEIC, TIFF, BMP) não são aceitos. Converta para JPG.
- **"Não detectamos texto automaticamente"** — não significa que a imagem está limpa; significa que o OCR não encontrou texto reconhecível. Você ainda precisa **revisar visualmente** e adicionar blocos manuais se necessário.

## Diferença para PDF

Para anexar **PDFs**, o fluxo é outro: a plataforma redige automaticamente quando há camada de texto e abre uma tela de **preview** para conferência. O editor manual de canvas é exclusivo para imagens. Veja **Anexar PDF** para detalhes.
