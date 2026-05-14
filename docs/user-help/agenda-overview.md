# Agenda — Visão Geral

A **Agenda** é onde o médico ou veterinário gerencia seus horários de consulta/atendimento. Cada profissional tem sua própria agenda; a configuração é individual.

## Como acessar

1. No menu lateral, clique em **Agenda** (ícone de calendário).
2. A tela abre na **semana atual**, com os horários desenhados de segunda a domingo.

## O que aparece na tela

- **Faixa azul claro vertical**: indica os horários de atendimento configurados pra cada dia (exemplo: 09:00–12:00 e 14:00–18:00).
- **Cartões coloridos**: cada agendamento ou bloqueio aparece como um cartão dentro do dia/horário correspondente.
- **Coluna de horas à esquerda**: vai das 7h às 22h, com linhas a cada hora.

## Cores dos cartões

Cada status tem uma cor pra leitura rápida:

| Status | Cor | Quando aparece |
|---|---|---|
| Agendado | Azul | Agendamento criado, paciente ainda não confirmou |
| Confirmado | Verde | Paciente confirmou presença |
| Concluído | Cinza | Atendimento já realizado |
| Cancelado | Vermelho tracejado | Cancelado (slot livre pra novo agendamento) |
| Faltou | Laranja | Paciente não compareceu (no-show) |
| Bloqueado | Cinza listrado | Horário não disponível (almoço, congresso, etc.) |

## Navegando

- **← / Hoje / →**: volta uma semana, vai pra hoje, avança uma semana
- **Configurações** (ícone engrenagem no canto): abre as configurações da agenda

No celular, os botões ← e → navegam **um dia por vez** (a tela mostra um dia inteiro por vez pra ficar legível em telas pequenas).

## Criando um agendamento

1. Clique em qualquer **espaço vazio** num dia/horário disponível.
2. Aparece um diálogo com duas opções:
   - **Consulta/Atendimento**: digite o nome do paciente/animal no autocomplete e selecione.
   - **Bloquear horário**: digite o motivo (ex: "Almoço", "Congresso").
3. Confira a duração (vem com o padrão configurado, mas pode mudar).
4. Adicione notas se quiser.
5. Clique em **Salvar**.

Se o horário já estiver ocupado, aparece um aviso claro. Não dá pra criar dois agendamentos sobrepostos do mesmo profissional — o sistema bloqueia automaticamente.

## Editando um agendamento

1. Clique sobre o cartão do agendamento.
2. Abre o modal de edição.
3. Você pode:
   - Alterar status (Confirmar, Concluir, Marcar falta, Cancelar)
   - Mudar duração
   - Editar notas
   - Em bloqueios: editar motivo ou excluir o bloqueio

## Reagendando (arrastar e soltar)

No desktop, **arraste** qualquer agendamento ativo (azul, verde) pra outro horário ou outro dia. O sistema:

- Mostra um contorno azul tracejado no dia de destino enquanto você arrasta
- Atualiza imediatamente ao soltar
- Reverte e mostra aviso se o novo horário já estiver ocupado

Atendimentos já concluídos, cancelados ou marcados como faltou **não podem** ser arrastados (status final).

No celular, pra reagendar, abra o cartão e edite a data/horário no modal.

## Limites e regras

- **Não-sobreposição**: o banco impede dois agendamentos sobrepostos do mesmo profissional. Tentativas falham com mensagem clara.
- **Cancelar libera o horário**: ao cancelar um agendamento, o slot fica livre automaticamente — outro paciente pode ser marcado nele.
- **Histórico preservado**: agendamentos cancelados continuam visíveis na agenda (tracejados) por um tempo, pra auditoria. Eles não impedem novos agendamentos no mesmo horário.
- **Excluir** só funciona pra **bloqueios**. Atendimentos cancelados ficam no histórico — pra remover, contate o suporte.
