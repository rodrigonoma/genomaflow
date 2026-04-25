# Chat entre Clínicas — Visão Geral

O **Chat entre Clínicas** é o canal direto de comunicação entre duas clínicas da plataforma GenomaFlow. Foi pensado para discussão de casos clínicos (segunda opinião) e questões operacionais (parcerias, disponibilidade de procedimentos), com proteção de dados pessoais embutida.

## Quem pode usar

- Apenas usuários com perfil **administrador** da clínica.
- Cada clínica fala apenas com clínicas do **mesmo módulo**: clínica humana só com clínica humana, clínica veterinária só com clínica veterinária.

## Como abrir uma conversa

1. Acesse **Chat entre clínicas** no menu lateral.
2. Use a aba **Diretório** para encontrar clínicas que se tornaram visíveis para receber convites.
3. Clique em **Convidar** e escreva uma mensagem inicial explicando o motivo do contato.
4. A clínica destinatária recebe uma notificação e decide se aceita ou recusa.
5. Após o aceite, a conversa fica disponível em **Conversas**.

Você pode receber convites de outras clínicas mesmo sem aparecer no diretório — basta que a outra clínica saiba o nome ou e-mail.

## Aparecer no diretório

Por padrão sua clínica **não aparece** no diretório (privacidade primeiro). Para aparecer:

1. Vá em **Editar Perfil da Clínica** (menu de usuário).
2. Ative **Aparecer no diretório de Chat entre Clínicas**.
3. Opcionalmente, preencha especialidades — facilita ser encontrado por buscas relevantes.

Você pode desativar a qualquer momento; sua clínica deixa de aparecer mas as conversas existentes continuam.

## O que dá pra fazer numa conversa

- Trocar **mensagens de texto** (até 5000 caracteres por mensagem).
- Anexar **PDF** com redação automática de dados pessoais.
- Anexar **imagem** (PNG ou JPEG) com editor visual para ocultar dados pessoais.
- Anexar **análise de IA** de um exame, anonimizada (sem nome do paciente, CPF, microchip, data de nascimento exata etc.).
- **Reagir** com emojis 👍 ❤️ 🤔 ✅ 🚨 📌.
- **Buscar** mensagens dentro da conversa por palavra-chave.
- Ver o **contato da clínica** (e-mail, telefone) para conversas que ultrapassam o que cabe no chat.

## Notificações

- O ícone **Chat entre clínicas** no menu lateral mostra um badge com o **total** de mensagens não lidas, somando todas as conversas.
- Mensagens novas chegam em tempo real (não precisa recarregar a página).
- Você também pode optar por receber e-mail quando chegar mensagem nova — em **Editar Perfil da Clínica**.

## Limites de uso

- **Convites**: até 20 por dia, por clínica.
- **Mensagens**: até 200 por dia, por clínica.
- **Anexos**: até 10MB por arquivo (PDF ou imagem).
- Convidar uma clínica que **rejeitou** três vezes seu convite nos últimos 30 dias fica bloqueado temporariamente.

## Regras de comportamento

- O envio de **dados pessoais identificáveis** (nome do paciente, CPF, RG, microchip, telefone, e-mail, endereço, foto identificável) é proibido sem consentimento expresso do titular. A plataforma aplica filtros automáticos, mas a responsabilidade final é do administrador que envia.
- Mensagens **abusivas, fraudulentas ou que violem a LGPD** podem ser denunciadas. Três denúncias procedentes de clínicas distintas em 30 dias resultam em **suspensão automática** do chat para a clínica envolvida.
- Encaminhamento formal de paciente (transferência de prontuário etc.) **não** é objetivo deste chat — utilize processos clínicos próprios fora da plataforma.

## Privacidade e LGPD

- Conversas são privadas entre as duas clínicas — **nenhum outro tenant** vê o conteúdo.
- O conteúdo é armazenado em banco de dados protegido com isolamento por clínica (RLS).
- Anexos ficam em armazenamento privado com URLs assinadas de acesso temporário (1 hora).
- A plataforma **não envia** anexos do chat para os agentes de IA clínica — eles ficam restritos à conversa.
