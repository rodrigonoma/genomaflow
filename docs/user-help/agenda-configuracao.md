# Configurando a Agenda

Antes de começar a marcar atendimentos, configure sua agenda em **Agenda → ícone de engrenagem** (canto superior direito).

## Duração padrão

Define a duração default de novos agendamentos. Você pode escolher entre:

- **30 minutos** (padrão)
- **45 minutos**
- **60 minutos** (1 hora)
- **75 minutos**
- **90 minutos** (1h30)
- **105 minutos**
- **120 minutos** (2 horas)

A lista é fechada — esses são os intervalos suportados pra manter a grid da agenda alinhada e legível.

### Mudando a duração ao longo do tempo

Você pode mudar a duração padrão a qualquer momento. **Importante:**

> **Agendamentos já criados mantêm a duração original.** Apenas novos agendamentos passam a usar a nova duração.

Exemplo prático:
- Janeiro: configurado 30 min. Você marca 50 consultas.
- Junho: muda pra 45 min.
- As 50 consultas de janeiro até maio continuam com 30 min visualmente.
- A partir de junho, novos agendamentos têm 45 min por padrão (pode mudar individualmente no momento da criação).

Isso evita migrações automáticas surpresa que poderiam causar conflitos no histórico.

### Ajustando a duração de um agendamento específico

Mesmo com duração padrão configurada, você pode mudar a duração ao criar (no diálogo) ou ao editar (no modal). Útil pra atendimentos especiais que precisam de mais tempo (procedimento longo, primeira consulta detalhada, etc.).

## Horários de atendimento

Configure quais dias da semana você atende e em que horário.

Pra cada dia (segunda a domingo):

- **Checkbox**: marque pra ativar o dia (atende neste dia)
- **Início** e **Fim**: horário do expediente (ex: 09:00 → 18:00)

Dias desativados (sem checkbox) ficam **cinza** na grid e não permitem criar agendamentos.

### Horário em janelas múltiplas

Por enquanto, a interface aceita **uma janela por dia** (exemplo: 09:00 → 18:00). Se você tem horário com almoço (09:00–12:00 e 14:00–18:00), defina o início da primeira janela e o fim da última (09:00–18:00) — o slot do almoço aparece como um bloco azul claro normal e você pode bloqueá-lo manualmente todos os dias clicando nele e escolhendo "Bloquear horário".

Em versões futuras, será possível configurar múltiplas janelas por dia diretamente.

### Sábado e domingo

Por padrão, sábado e domingo vêm desativados. Se você atende, marque o checkbox e defina o horário.

## Privacidade

A configuração da sua agenda é **só sua** — outros profissionais da mesma clínica (futuras versões da plataforma) não veem seus horários sem permissão explícita. A agenda é multiusuário-pronta no banco; a interface multi-doctor entra numa próxima versão.

## Aviso importante

> A configuração que você salva **não dispara nenhuma cobrança** nem altera dados clínicos. É apenas uma referência visual e de validação na hora de criar agendamentos.
