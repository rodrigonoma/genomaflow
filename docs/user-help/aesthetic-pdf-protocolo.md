# Protocolo em PDF + Agenda — Guia do Profissional de Estética

> **Módulo:** Estética (`module = estetica`)
> **Namespace RAG:** `product_help`
> **Atualizado em:** 2026-05-12

---

## Visualizar e baixar o PDF

Após uma análise concluir, o resultado mostra um botão **"Visualizar PDF"** no cabeçalho. Ao clicar:

1. **Modal de preview** abre com a imagem do PDF embarcada via iframe.
2. O PDF é gerado on-demand pelo backend (`GET /aesthetic/analyses/:id/export.pdf`) — não há armazenamento persistente.
3. **Botão "Baixar"** no topo do modal salva o PDF localmente.
4. Para fechar sem baixar, clique no X.

O PDF contém:

| Seção | Conteúdo |
|---|---|
| Header | Logo "GenomaFlow" + nome da clínica |
| Paciente | Nome, data de nascimento, sexo |
| Análise | Tipo (facial/corporal), data de conclusão, ID |
| Métricas | Top 12 ranqueadas por score (com confidence quando disponível) |
| Protocolo de tratamento | Cada tratamento sugerido: nome, indicação, sessões × intervalo, custo estimado, resultado esperado |
| Orientações de estilo de vida | Calorias, macros, hidratação, exercício, foods to emphasize/minimize |
| Disclaimer regulatório | LGPD/CFM/CRN |
| Footer | Data de emissão + identificação do sistema |

O PDF usa **fonte Roboto embarcada via fontkit** — acentos PT-BR ficam corretos (Análise, Métricas, Orientações, etc.).

---

## Agendar uma sessão de tratamento

Cada cartão no protocolo tem o botão **"Agendar agora"**. Ao clicar:

1. Abre o `quick-create-dialog` da agenda da clínica.
2. **Pré-preenchimento automático:**
   - `appointment_type = procedimento` 
   - Paciente já selecionado
   - Notas mencionam: tratamento sugerido + ID da análise (rastreabilidade)
3. Você ajusta data/hora/duração e confirma.

**Botão desabilitado** quando o tratamento aparece como "Em breve catálogo" — só após o master promover essa sugestão é que o botão libera.

---

## Agendar série de N sessões (recomendado pela IA)

Quando o tratamento tem `sessions_recommended > 1` (ex: Microagulhamento → 4 sessões a cada 30 dias), o dialog mostra um **toggle "Repetir N vezes a cada D dias"** — ativo por default com os valores sugeridos pelo catálogo.

1. Confirme ou ajuste:
   - **Quantidade** (clamp 2-20)
   - **Intervalo em dias** (clamp 1-365)
2. Clique "Salvar".
3. O backend cria **N appointments transacionalmente** (BEGIN/COMMIT). Se qualquer um conflitar com outro horário, ROLLBACK — nenhum é criado, você ajusta a data inicial.

Cada appointment criado dispara o scheduler de lembretes existente (T-24h e T-2h via WhatsApp/SMS conforme configuração da clínica).

---

## Timeline integrada

Análises concluídas aparecem na aba "Timeline" da ficha do cliente como evento **"Análise Estética"** (ícone rosa). Ao clicar no card:

1. O painel de detalhe abre mostrando: tipo, fotos analisadas, top 3 métricas.
2. Botão **"Ver análise completa"** navega direto para a aba "Análise Estética IA" do mesmo cliente, com a análise específica carregada no resultado.

Útil para retomar uma análise antiga durante consulta.

---

## Vincular encounter (prontuário) a uma análise

Ao registrar um encounter no módulo estética:

- O sistema mostra dropdown "Análise estética vinculada"
- **Auto-suggest**: se há análise recente (≤30 dias, status='done') sem vínculo prévio, o sistema pré-seleciona automaticamente a mais recente.
- Banner inline: *"Vinculado automaticamente à análise mais recente. Você pode trocar ou remover."*
- Você pode aceitar ou trocar manualmente.

O vínculo é guardado em `clinical_encounters.related_aesthetic_analysis_id` (multi-módulo safe, nullable).

---

## Histórico de aesthetic_profile

Na aba "Perfil Estético", o botão "Ver histórico de mudanças" mostra a cronologia de updates do perfil antropométrico:
- Quem mudou (e-mail)
- Quando
- Diff resumido (ex: "weight_kg: 65 → 67", "activity_level: light → moderate")

---

## FAQ

### O PDF inclui as fotos da análise?

Hoje o PDF é só texto (métricas + protocolo + lifestyle + disclaimer). Versão futura pode incluir miniaturas das fotos da análise — mas precisa cuidado especial para fotos sensíveis (não devem entrar em PDF compartilhável).

### Posso compartilhar o PDF com o cliente?

Sim — o PDF é projetado para ser entregue ao cliente como protocolo recomendado. O disclaimer regulatório está embarcado no documento.

### Quantas sessões posso agendar em série?

Mínimo 2, máximo 20 (clamp de segurança contra erro de digitação). Se precisar mais, crie séries separadas.

### O que acontece se uma sessão da série conflitar com outro horário?

A criação é transacional: se UMA sessão conflitar, NENHUMA é criada. Você ajusta a data inicial ou intervalo até encontrar uma sequência livre.

### Lembretes funcionam para sessões em série?

Sim — cada appointment criado entra no scheduler de notificações existente (T-24h e T-2h via WhatsApp/SMS conforme configuração da clínica). Sem código adicional necessário.

### Posso editar o vínculo entre encounter e análise depois?

Sim — abra o encounter via prontuário, ajuste o dropdown. O endpoint PATCH valida que a análise pertence ao mesmo paciente/tenant.

### O PDF expira?

O PDF é gerado on-demand e baixado pelo cliente. Não fica armazenado em S3. Cada chamada ao endpoint regera o documento com os dados atualizados da análise.
