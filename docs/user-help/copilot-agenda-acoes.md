# Copilot — Agendar e Cancelar pelo Chat

O **Copilot de Ajuda** (ícone de fone de ouvido no topo direito) agora não só responde dúvidas — também **executa ações na sua agenda** quando você pede em linguagem natural.

## O que ele faz

- **Ver agenda**: "o que tenho hoje?", "agenda da semana", "amanhã estou cheio?"
- **Criar agendamento**: "marca consulta da Maria Silva amanhã 14h", "agenda atendimento do Rex segunda 10h por 1 hora"
- **Bloquear horário**: "bloqueia sexta de manhã pra congresso"
- **Cancelar**: "cancela meu próximo atendimento", "cancela consulta da Maria amanhã"
- **Ver detalhes**: "mostra meu próximo agendamento", "qual é o de Joana?"

Ele continua respondendo perguntas comuns de uso da plataforma também — mesmo lugar, mesma conversa.

## Como abrir

Clique no ícone de **fone de ouvido** no topo direito (entre o ícone de robô clínico e o menu do usuário). O painel abre do lado direito.

## Atalhos rápidos

Ao abrir o Copilot vazio, aparecem 4 chips clicáveis com perguntas comuns. Clique pra usar imediatamente sem digitar.

## Voz (microfone)

No rodapé do Copilot, ao lado do botão **Enviar**, tem um botão de **microfone**:

1. Clique no microfone (cinza)
2. Browser pode pedir permissão de áudio na primeira vez — aceite
3. Botão fica vermelho pulsando indicando que está gravando
4. Fale o que quer fazer (em pt-BR)
5. O texto aparece em tempo real no campo de input
6. Clique de novo no microfone pra parar (ou pause de fala automaticamente encerra)
7. **Revise o texto** e clique **Enviar** quando estiver certo

A transcrição roda **dentro do seu navegador** — o áudio nunca sai do seu dispositivo. Apenas o texto final é enviado.

### Browsers suportados

- ✅ **Chrome** (desktop e Android)
- ✅ **Edge**
- ✅ **Safari** (macOS e iOS)
- ❌ **Firefox** — botão não aparece (suporte limitado a Web Speech API)

## Confirmação para ações destrutivas

Para **cancelar** ou **excluir** algo, o Copilot **sempre pergunta antes**:

> Você: "cancela meu próximo atendimento"
>
> Copilot: "Você tem o atendimento de Trovão (Souza) hoje às 16:00. **Confirma cancelar?**"
>
> Você: "sim" (ou "pode cancelar")
>
> Copilot: "✓ Cancelado — Trovão (Souza), 26/04 16:00"

Isso evita cancelamentos por engano. Você pode dizer "sim" no chat ou clicar diretamente, ou "não" se quiser desistir.

## Indicadores visuais

Enquanto o Copilot processa sua solicitação, você vê:

- **Spinner azul + "Buscando paciente..."** — quando consulta o banco
- **Spinner azul + "Consultando agenda..."** — quando lista agendamentos
- **Check verde + "Criando agendamento..."** — quando ação completou com sucesso
- **Erro vermelho + "Cancelando agendamento..."** — quando algo falhou

## Dicas pra usar bem

- **Datas naturais**: "amanhã", "hoje", "próxima segunda", "dia 15", "amanhã às 14h", "duas da tarde", "meia-noite"
- **Durações**: padrão é 30 min. Especifique se diferente: "consulta de 1 hora", "bloqueio de 2 horas". Lista de durações suportadas: 30, 45, 60, 75, 90, 105, 120 min.
- **Nomes parciais**: "Maria" funciona — se houver várias Marias, o Copilot pergunta qual
- **Conversa contínua**: ele lembra dos turnos anteriores na mesma sessão. Pode dizer "agora cancela essa" depois de criar
- **Iniciar nova conversa**: ícone de refresh no topo do painel limpa o histórico

## Limitações da V1

- **Só sua agenda própria** — não pode agendar pra outro médico da clínica
- **Não move agendamentos** — se quiser remarcar, cancele e crie novo (V2 vai trazer "remarcar")
- **Não configura horário comercial** via chat — use o botão de engrenagem na Agenda
- **Idioma fixo pt-BR** — Web Speech API configurado para português brasileiro
- **Sem ações em outras áreas** — V1 cobre só agenda; chat entre clínicas, prescrição, etc. virão depois

## Privacidade e segurança

- O Copilot age **como você** — todas as ações ficam registradas com seu usuário no log de auditoria da plataforma
- Cada pergunta + cada ação ficam gravadas com data, hora e resultado pra rastreabilidade
- Tools internas validam que a ação é na sua clínica e na sua agenda — não há como manipular o assistente pra agir em outro tenant
- A IA **nunca** executa ações destrutivas sem pedir sua confirmação explícita
