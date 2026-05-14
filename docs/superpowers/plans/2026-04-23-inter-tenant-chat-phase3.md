# Chat Entre Tenants V1 — Fase 3 (WebSocket + Frontend Chat) Implementation Plan

**Goal:** Entregar UX funcional de chat entre tenants — backend emite eventos WebSocket nos pontos certos (mensagem nova, convite recebido, convite aceito, unread mudou), e o frontend Angular ganha uma tela `/chat` com lista de conversas, thread, envio de texto, modal de diretório pra convidar, painel de convites recebidos, e badge de unread no menu lateral. WebSocket + REST fornecem atualização em tempo real sem polling.

**Architecture:** Backend reutiliza `fastify.notifyTenant()` existente (mesmo caminho do exam:done) para push WS. Frontend estende `WsService` com eventos chat, um `ChatService` novo faz REST + observa WS. Componentes standalone: `ChatPageComponent` (rota `/chat`), `ConversationListComponent`, `ThreadComponent`, `DirectoryModalComponent`, `InvitesPanelComponent`. Badge no `AppComponent` topbar/sidebar.

**Tech Stack:** Node.js/Fastify (backend), Angular 18 standalone (frontend), RxJS, Material Design.

**Branch:** `feat/chat-phase3-ws-frontend`

**Spec:** `docs/superpowers/specs/2026-04-23-inter-tenant-chat-design.md` §8 (WebSocket) + §9 (UI/UX)

**Estado de partida:** Phase 1 + Phase 2 mergeadas em main. Migrations 047+048 aplicadas. API REST `/inter-tenant-chat/*` funcional em prod.

---

## File Structure

**Backend (modify):**
- `apps/api/src/routes/inter-tenant-chat/invitations.js` — emitir `chat:invitation_received`, `chat:invitation_accepted`
- `apps/api/src/routes/inter-tenant-chat/messages.js` — emitir `chat:message_received` + `chat:unread_change`
- `apps/api/src/routes/inter-tenant-chat/reads.js` — emitir `chat:unread_change` pro próprio tenant

**Frontend (create):**
- `apps/web/src/app/shared/models/chat.models.ts` — tipos Conversation, Message, Invitation, DirectoryEntry, ChatSettings
- `apps/web/src/app/features/chat-inter-tenant/chat.service.ts` — HTTP + WS observables
- `apps/web/src/app/features/chat-inter-tenant/chat-page.component.ts` — rota principal `/chat`
- `apps/web/src/app/features/chat-inter-tenant/conversation-list.component.ts`
- `apps/web/src/app/features/chat-inter-tenant/thread.component.ts`
- `apps/web/src/app/features/chat-inter-tenant/directory-modal.component.ts`
- `apps/web/src/app/features/chat-inter-tenant/invites-panel.component.ts`
- `apps/web/src/app/features/chat-inter-tenant/chat.routes.ts` — child routes

**Frontend (modify):**
- `apps/web/src/app/core/ws/ws.service.ts` — adicionar subjects para eventos chat
- `apps/web/src/app/app.routes.ts` — registrar rota `/chat` com guard
- `apps/web/src/app/app.component.ts` — item sidebar + badge de unread

---

## Pre-flight

- [ ] **Step 0.1: Branch do main atualizado**
  ```bash
  git checkout main && git pull --ff-only origin main
  git checkout -b feat/chat-phase3-ws-frontend
  ```

- [ ] **Step 0.2: Verificar Phase 2 em prod**
  ```bash
  curl -s https://app.genomaflow.com.br/api/inter-tenant-chat/settings -w "HTTP %{http_code}\n" -o /dev/null
  ```
  Expected: HTTP 401 (endpoint vivo, auth necessária).

---

## Task 1: Backend — emitir WS events das rotas

Cada mutation no chat deve disparar `fastify.notifyTenant(tenantId, { event: 'chat:...', ... })` para o(s) tenant(s) relevante(s).

**Eventos a emitir:**

| Rota | Evento | Destinatários | Payload |
|---|---|---|---|
| POST /invitations | `chat:invitation_received` | `to_tenant_id` | `{ invitation_id, from_tenant_id, from_tenant_name, message }` |
| POST /invitations/:id/accept | `chat:invitation_accepted` | `from_tenant_id` | `{ invitation_id, conversation_id, counterpart_tenant_name }` |
| POST /conversations/:id/messages | `chat:message_received` | counterpart tenant | `{ conversation_id, message_id, sender_tenant_id, body_preview, created_at }` |
| POST /conversations/:id/messages | `chat:unread_change` | counterpart tenant | `{ conversation_id, delta: +1 }` |
| POST /conversations/:id/read | `chat:unread_change` | self tenant | `{ conversation_id, delta: -N }` (N = qtd lida) |

**Files:**
- Modify: `apps/api/src/routes/inter-tenant-chat/invitations.js`
- Modify: `apps/api/src/routes/inter-tenant-chat/messages.js`
- Modify: `apps/api/src/routes/inter-tenant-chat/reads.js`

- [ ] **Step 1.1: Adicionar emit no POST /invitations**

Logo após o `return reply.status(201).send(inv);`, antes de retornar, emitir:

```javascript
// Notifica o destinatário em tempo real
try {
  const { rows: [sender] } = await fastify.pg.query(
    `SELECT name FROM tenants WHERE id = $1`, [tenant_id]
  );
  fastify.notifyTenant(to_tenant_id, {
    event: 'chat:invitation_received',
    invitation_id: inv.id,
    from_tenant_id: tenant_id,
    from_tenant_name: sender?.name || '',
    message: inv.message,
  });
} catch (e) { /* notification é best-effort */ }
```

- [ ] **Step 1.2: Adicionar emit no POST /invitations/:id/accept**

No bloco `return reply.status(result.code).send(result.body);` (quando code=201), emitir para `inv.from_tenant_id`:

```javascript
if (result.code === 201) {
  try {
    const { rows: [accepter] } = await fastify.pg.query(
      `SELECT name FROM tenants WHERE id = $1`, [tenant_id]
    );
    // result.from_tenant_id precisa estar disponível — retornar na função interna
    fastify.notifyTenant(result.from_tenant_id, {
      event: 'chat:invitation_accepted',
      invitation_id: result.body.invitation_id,
      conversation_id: result.body.conversation_id,
      counterpart_tenant_name: accepter?.name || '',
    });
  } catch (e) {}
}
```

Para isso, ajustar o bloco interno do `withTenant` em `/accept` para retornar `from_tenant_id` também:

```javascript
return { code: 201, body: {...}, from_tenant_id: inv.from_tenant_id };
```

- [ ] **Step 1.3: Adicionar emit no POST /conversations/:id/messages**

Após o `INSERT INTO tenant_messages ... RETURNING ...`, dentro do mesmo `withConversationAccess`, retornar também `counterpart_id`. Depois da transação, emitir:

```javascript
fastify.notifyTenant(counterpartId, {
  event: 'chat:message_received',
  conversation_id: id,
  message_id: msg.id,
  sender_tenant_id: tenant_id,
  body_preview: msg.body.length > 120 ? msg.body.slice(0, 120) + '…' : msg.body,
  created_at: msg.created_at,
});
fastify.notifyTenant(counterpartId, {
  event: 'chat:unread_change',
  conversation_id: id,
  delta: 1,
});
```

Para obter o `counterpart_id`: dentro de `withConversationAccess`, o segundo argumento de `fn` é a `conversation` row. Do row, derivar `counterpart_tenant_id = conv.tenant_a_id === tenant_id ? conv.tenant_b_id : conv.tenant_a_id`.

- [ ] **Step 1.4: Adicionar emit no POST /conversations/:id/read**

Dentro da transação do `withConversationAccess`, após o UPSERT em `tenant_conversation_reads`, calcular quantas mensagens foram marcadas como lidas (= delta negativo do unread). Depois da transação, emitir pra self:

```javascript
fastify.notifyTenant(tenant_id, {
  event: 'chat:unread_change',
  conversation_id: conversationId,
  delta: -readCount,  // absoluto: zera no cliente
  absolute: 0,  // hint pro cliente: unread deste conv agora é 0
});
```

- [ ] **Step 1.5: Rodar testes de rotas — zero regressão**

```bash
cd apps/api && DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/genomaflow_test npx jest tests/routes/inter-tenant-chat/ 2>&1 | tail -10
```

Expected: 59/59 PASS. `notifyTenant` é best-effort no test runtime (se pubsub plugin não estiver montado, try/catch engole).

- [ ] **Step 1.6: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/
git commit -m "feat(chat): backend emite eventos WS das rotas de chat

Após INSERT/UPDATE nas rotas POST /invitations, /invitations/:id/accept,
/messages, /read, o handler chama fastify.notifyTenant(tenantId, {...})
para push WebSocket em tempo real aos destinatários relevantes.

Eventos: chat:invitation_received, chat:invitation_accepted,
chat:message_received, chat:unread_change. Best-effort (try/catch)
— falha de notificação não derruba o request principal."
```

---

## Task 2: Frontend — tipos + estender WsService

**Files:**
- Create: `apps/web/src/app/shared/models/chat.models.ts`
- Modify: `apps/web/src/app/core/ws/ws.service.ts`

- [ ] **Step 2.1: Tipos do chat**

Create `apps/web/src/app/shared/models/chat.models.ts`:

```typescript
export interface ChatSettings {
  tenant_id: string;
  visible_in_directory: boolean;
  notify_on_invite_email: boolean;
  notify_on_message_email: boolean;
  message_email_quiet_after_minutes: number;
  created_at?: string;
  updated_at?: string;
}

export interface DirectoryEntry {
  tenant_id: string;
  name: string;
  module: 'human' | 'veterinary';
  region_uf: string | null;
  region_city: string | null;
  specialties: string[];
  last_active_month: string | null;
}

export interface InterTenantInvitation {
  id: string;
  from_tenant_id: string;
  to_tenant_id: string;
  from_tenant_name: string;
  to_tenant_name: string;
  module: 'human' | 'veterinary';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  message: string | null;
  sent_at: string;
  responded_at: string | null;
}

export interface InterTenantConversation {
  id: string;
  counterpart_tenant_id: string;
  counterpart_name: string;
  module: 'human' | 'veterinary';
  last_message_at: string | null;
  created_at: string;
  last_message_preview: string | null;
  unread_count: number;
  archived: boolean;
}

export interface InterTenantMessage {
  id: string;
  conversation_id: string;
  sender_tenant_id: string;
  sender_user_id: string;
  body: string;
  has_attachment: boolean;
  created_at: string;
}

export interface ChatSearchResult {
  id: string;
  sender_tenant_id: string;
  body: string;
  created_at: string;
  snippet: string;
}

export interface TenantBlock {
  blocker_tenant_id: string;
  blocked_tenant_id: string;
  blocked_tenant_name?: string;
  reason: string | null;
  created_at: string;
}
```

- [ ] **Step 2.2: Estender WsService**

**Edit** `apps/web/src/app/core/ws/ws.service.ts`. Adicionar após os subjects existentes:

```typescript
// Chat entre tenants events
chatInvitationReceived$ = new Subject<{ invitation_id: string; from_tenant_id: string; from_tenant_name: string; message: string | null }>();
chatInvitationAccepted$ = new Subject<{ invitation_id: string; conversation_id: string; counterpart_tenant_name: string }>();
chatMessageReceived$    = new Subject<{ conversation_id: string; message_id: string; sender_tenant_id: string; body_preview: string; created_at: string }>();
chatUnreadChange$       = new Subject<{ conversation_id: string; delta: number; absolute?: number }>();
```

No bloco `onmessage`, adicionar casos (dentro do `zone.run(...)`):

```typescript
if (kind === 'chat:invitation_received') {
  this.chatInvitationReceived$.next(msg as any);
} else if (kind === 'chat:invitation_accepted') {
  this.chatInvitationAccepted$.next(msg as any);
} else if (kind === 'chat:message_received') {
  this.chatMessageReceived$.next(msg as any);
} else if (kind === 'chat:unread_change') {
  this.chatUnreadChange$.next(msg as any);
}
```

Colocar esses antes do `else { this.examUpdates$.next(...) }` final, para não vazar pro exam handler.

- [ ] **Step 2.3: Build passa**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -10
```

Expected: build OK (warnings pré-existentes aceitáveis).

- [ ] **Step 2.4: Commit**

```bash
git add apps/web/src/app/shared/models/chat.models.ts apps/web/src/app/core/ws/ws.service.ts
git commit -m "feat(chat): tipos + WS subjects do chat entre tenants no frontend

Interfaces: ChatSettings, DirectoryEntry, InterTenantInvitation,
InterTenantConversation, InterTenantMessage, ChatSearchResult,
TenantBlock. WsService ganha 4 subjects: chatInvitationReceived\$,
chatInvitationAccepted\$, chatMessageReceived\$, chatUnreadChange\$."
```

---

## Task 3: ChatService + rota /chat + shell

**Files:**
- Create: `apps/web/src/app/features/chat-inter-tenant/chat.service.ts`
- Create: `apps/web/src/app/features/chat-inter-tenant/chat-page.component.ts`
- Create: `apps/web/src/app/features/chat-inter-tenant/chat.routes.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 3.1: ChatService**

Create `apps/web/src/app/features/chat-inter-tenant/chat.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChatSettings, DirectoryEntry, InterTenantInvitation,
  InterTenantConversation, InterTenantMessage, ChatSearchResult, TenantBlock
} from '../../shared/models/chat.models';

interface Page<T> { results: T[]; page?: number; page_size?: number; }

@Injectable({ providedIn: 'root' })
export class ChatService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/inter-tenant-chat`;

  // Settings
  getSettings(): Observable<ChatSettings> { return this.http.get<ChatSettings>(`${this.base}/settings`); }
  updateSettings(patch: Partial<ChatSettings>): Observable<ChatSettings> {
    return this.http.put<ChatSettings>(`${this.base}/settings`, patch);
  }

  // Directory
  searchDirectory(opts: { uf?: string; specialty?: string; q?: string; page?: number; page_size?: number }): Observable<Page<DirectoryEntry>> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(opts)) if (v != null && v !== '') params = params.set(k, String(v));
    return this.http.get<Page<DirectoryEntry>>(`${this.base}/directory`, { params });
  }

  // Invitations
  listInvitations(direction: 'incoming' | 'outgoing' = 'incoming'): Observable<Page<InterTenantInvitation>> {
    return this.http.get<Page<InterTenantInvitation>>(`${this.base}/invitations`, { params: { direction } });
  }
  sendInvitation(to_tenant_id: string, message?: string): Observable<InterTenantInvitation> {
    return this.http.post<InterTenantInvitation>(`${this.base}/invitations`, { to_tenant_id, message });
  }
  acceptInvitation(id: string): Observable<{ invitation_id: string; conversation_id: string }> {
    return this.http.post<{ invitation_id: string; conversation_id: string }>(`${this.base}/invitations/${id}/accept`, {});
  }
  rejectInvitation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/invitations/${id}/reject`, {});
  }
  cancelInvitation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/invitations/${id}`);
  }

  // Conversations
  listConversations(): Observable<Page<InterTenantConversation>> {
    return this.http.get<Page<InterTenantConversation>>(`${this.base}/conversations`);
  }
  getConversation(id: string): Observable<InterTenantConversation> {
    return this.http.get<InterTenantConversation>(`${this.base}/conversations/${id}`);
  }
  archiveConversation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversations/${id}/archive`, {});
  }
  unarchiveConversation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversations/${id}/unarchive`, {});
  }
  deleteConversation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/conversations/${id}`);
  }

  // Messages
  listMessages(conversationId: string, opts: { before?: string; limit?: number } = {}): Observable<Page<InterTenantMessage>> {
    let params = new HttpParams();
    if (opts.before) params = params.set('before', opts.before);
    if (opts.limit)  params = params.set('limit',  String(opts.limit));
    return this.http.get<Page<InterTenantMessage>>(`${this.base}/conversations/${conversationId}/messages`, { params });
  }
  sendMessage(conversationId: string, body: string): Observable<InterTenantMessage> {
    return this.http.post<InterTenantMessage>(`${this.base}/conversations/${conversationId}/messages`, { body });
  }
  searchMessages(conversationId: string, q: string): Observable<Page<ChatSearchResult>> {
    return this.http.get<Page<ChatSearchResult>>(`${this.base}/conversations/${conversationId}/search`, { params: { q } });
  }
  markRead(conversationId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/conversations/${conversationId}/read`, {});
  }

  // Blocks
  listBlocks(): Observable<Page<TenantBlock>> { return this.http.get<Page<TenantBlock>>(`${this.base}/blocks`); }
  blockTenant(blocked_tenant_id: string, reason?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/blocks`, { blocked_tenant_id, reason });
  }
  unblockTenant(tenantId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/blocks/${tenantId}`);
  }
}
```

- [ ] **Step 3.2: Chat page + layout**

Create `apps/web/src/app/features/chat-inter-tenant/chat-page.component.ts`:

```typescript
import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { ChatService } from './chat.service';
import { WsService } from '../../core/ws/ws.service';
import { ConversationListComponent } from './conversation-list.component';
import { ThreadComponent } from './thread.component';
import { DirectoryModalComponent } from './directory-modal.component';
import { InvitesPanelComponent } from './invites-panel.component';
import { InterTenantConversation } from '../../shared/models/chat.models';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDialogModule,
            ConversationListComponent, ThreadComponent, InvitesPanelComponent],
  styles: [`
    :host { display: flex; height: calc(100vh - 56px); background: #0b1326; color: #dae2fd; }
    .sidebar { width: 320px; border-right: 1px solid rgba(70,69,84,0.15); display: flex; flex-direction: column; }
    .sidebar-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem; border-bottom: 1px solid rgba(70,69,84,0.15);
    }
    .sidebar-title {
      font-family: 'Space Grotesk', sans-serif; font-weight: 700;
      font-size: 1.125rem; color: #c0c1ff;
    }
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .empty {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: #7c7b8f; font-family: 'JetBrains Mono', monospace; font-size: 0.75rem;
    }
    .new-conv-btn { color: #c0c1ff; }
  `],
  template: `
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">Chat</span>
        <div>
          <button mat-icon-button class="new-conv-btn" matTooltip="Convites" (click)="togglePanel()">
            <mat-icon>inbox</mat-icon>
            @if (pendingInvitesCount() > 0) {
              <span class="badge-small">{{ pendingInvitesCount() }}</span>
            }
          </button>
          <button mat-icon-button class="new-conv-btn" matTooltip="Nova conversa" (click)="openDirectory()">
            <mat-icon>add</mat-icon>
          </button>
        </div>
      </div>
      @if (showInvites()) {
        <app-invites-panel (closed)="showInvites.set(false)" (accepted)="onInviteAccepted($event)" />
      } @else {
        <app-conversation-list
          [selectedId]="selectedConversationId()"
          (select)="onSelect($event)" />
      }
    </aside>
    <main class="main">
      @if (selectedConversationId()) {
        <app-thread [conversationId]="selectedConversationId()!" />
      } @else {
        <div class="empty">Selecione uma conversa ou inicie uma nova.</div>
      }
    </main>
  `
})
export class ChatPageComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private ws = inject(WsService);
  private dialog = inject(MatDialog);

  selectedConversationId = signal<string | null>(null);
  showInvites = signal(false);
  pendingInvitesCount = signal(0);
  private subs = new Subscription();

  ngOnInit() {
    this.refreshInvitesCount();
    this.subs.add(this.ws.chatInvitationReceived$.subscribe(() => this.refreshInvitesCount()));
    this.subs.add(this.ws.chatInvitationAccepted$.subscribe(({ conversation_id }) => {
      this.selectedConversationId.set(conversation_id);
    }));
  }

  ngOnDestroy() { this.subs.unsubscribe(); }

  onSelect(id: string) {
    this.selectedConversationId.set(id);
    this.showInvites.set(false);
  }

  togglePanel() { this.showInvites.update(v => !v); }

  openDirectory() {
    const ref = this.dialog.open(DirectoryModalComponent, { width: '640px', panelClass: 'dark-dialog' });
    ref.afterClosed().subscribe((invitationSent) => {
      if (invitationSent) this.refreshInvitesCount();  // atualiza caso tenha convite próprio pendente (outgoing)
    });
  }

  onInviteAccepted(conversationId: string) {
    this.selectedConversationId.set(conversationId);
    this.showInvites.set(false);
    this.refreshInvitesCount();
  }

  private refreshInvitesCount() {
    this.chat.listInvitations('incoming').subscribe({
      next: (res) => {
        const pending = res.results.filter(i => i.status === 'pending').length;
        this.pendingInvitesCount.set(pending);
      }
    });
  }
}
```

- [ ] **Step 3.3: Child routes + registrar em app.routes.ts**

Create `apps/web/src/app/features/chat-inter-tenant/chat.routes.ts`:

```typescript
import { Routes } from '@angular/router';
export const CHAT_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./chat-page.component').then(m => m.ChatPageComponent) },
];
```

**Edit** `apps/web/src/app/app.routes.ts`. Adicionar rota `/chat` entre as existentes, com os guards atuais (authGuard + termsGuard + professionalInfoGuard):

```typescript
{
  path: 'chat',
  canActivate: [authGuard, termsGuard, professionalInfoGuard],
  loadChildren: () => import('./features/chat-inter-tenant/chat.routes').then(m => m.CHAT_ROUTES)
},
```

- [ ] **Step 3.4: Build deve passar (com stubs vazios pros 4 filhos — próxima task os cria)**

Para passar o build agora, criar stubs temporários vazios dos componentes filhos. Na tarefa seguinte implementamos de verdade.

Create (temporariamente):
- `conversation-list.component.ts` stub que exporta `ConversationListComponent` com template `<p>list</p>`
- `thread.component.ts` stub
- `directory-modal.component.ts` stub
- `invites-panel.component.ts` stub

(Full implementation vem na Task 4.)

- [ ] **Step 3.5: Commit**

---

## Task 4: ConversationListComponent + badge

**Files:**
- Modify: `apps/web/src/app/features/chat-inter-tenant/conversation-list.component.ts`
- Modify: `apps/web/src/app/app.component.ts` (badge no sidebar)

- [ ] **Step 4.1: ConversationList com refresh via WS**

Component standalone com:
- `@Input() selectedId: string | null`
- `@Output() select = new EventEmitter<string>()`
- Lista conversas via `chat.listConversations()`
- Subscribe em `ws.chatMessageReceived$` e `ws.chatUnreadChange$` pra re-fetch (simples) ou atualizar in-place (otimizado)
- Cada item: avatar (inicial), counterpart_name, last_message_preview, data, badge unread

UI: row pattern já estabelecido (`#111929` bg, border-left #c0c1ff quando selected).

- [ ] **Step 4.2: Badge no topbar/sidebar de AppComponent**

No `AppComponent` (`app.component.ts`):
- Adicionar `chatUnreadTotal = signal(0)` que agrega `sum(conv.unread_count)` de todas as conversas
- Na `ngOnInit()`, após o usuário estar autenticado, chamar chat.listConversations e calcular total
- Subscribe em `ws.chatMessageReceived$` pra incrementar e `ws.chatUnreadChange$` pra ajustar
- No item "Chat" do sidebar, exibir badge vermelho igual à review queue

---

## Task 5: ThreadComponent

**Files:** `apps/web/src/app/features/chat-inter-tenant/thread.component.ts`

- [ ] **Step 5.1: Thread view com messages + input**

Component com:
- `@Input() conversationId: string`
- ngOnInit: fetch messages + marca como lido (`chat.markRead`)
- ngOnChanges(conversationId): re-fetch, re-mark
- WS subscribe: chatMessageReceived$ filtrado pelo conversationId → append, chama markRead
- Scroll-to-bottom on new message
- Input (textarea + send button): chama `chat.sendMessage`, limpa, auto-grow altura

Estilo: bolhas (`background #171f33` para recebidas, `#494bd6` para enviadas).

---

## Task 6: DirectoryModal + InvitesPanel

**Files:**
- `directory-modal.component.ts`
- `invites-panel.component.ts`

- [ ] **Step 6.1: Directory modal**

MatDialog component com:
- Input de busca (debounced 300ms → `chat.searchDirectory`)
- Filtros: UF dropdown, specialty chips
- Lista de clínicas matching com botão "Convidar"
- Modal de confirmação com textarea de mensagem opcional
- `chat.sendInvitation(tenantId, message)` → fecha modal com retorno truthy

- [ ] **Step 6.2: Invites panel**

Component lista convites `incoming` em pendente:
- Cada convite: from_tenant_name, message, data
- Botões Aceitar / Recusar
- Emite `accepted` com conversation_id quando aceita
- Botão "Ver enviados" troca pra listar outgoing (view state interno)

---

## Task 7: Smoke manual + build + push

- [ ] **Step 7.1: Build + rebuild dos containers**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -5
cd /home/rodrigonoma/GenomaFlow && docker compose up -d --build web api 2>&1 | tail -5
```

- [ ] **Step 7.2: Smoke manual local**

Validar em http://localhost:4200/:
1. Login admin → sidebar mostra item "Chat"
2. Click "Chat" → `/chat` abre vazio ("Selecione uma conversa")
3. Click `+ Nova conversa` → modal de diretório
4. Busca por clínica, clica Convidar
5. Sair + logar como admin de outra clínica
6. Sidebar "Chat" mostra badge 1, painel de convites com 1 pending
7. Aceitar → conversation abre automaticamente via WS
8. Enviar mensagem → aparece na thread
9. Sair + logar como remetente original
10. Ver mensagem recebida + unread badge no sidebar
11. Abrir conversa → unread zera, last_read_at atualiza

- [ ] **Step 7.3: Atualizar CLAUDE.md**

Na seção "Comportamentos Esperados", adicionar:
- `WS event chat:invitation_received emitido pra to_tenant_id após POST /invitations`
- `WS event chat:message_received emitido pra counterpart após POST /messages`

- [ ] **Step 7.4: Commit + push**

```bash
git add ...
git commit -m "chore(chat): Phase 3 complete — WS events + frontend UI + sidebar badge"
git push -u origin feat/chat-phase3-ws-frontend
```

---

## Critérios de "pronto" da Phase 3

- [ ] Backend emite 4 eventos WS (invitation_received, invitation_accepted, message_received, unread_change)
- [ ] Frontend tem rota `/chat` com layout (sidebar + thread)
- [ ] Lista de conversas renderiza com last_message_preview + unread_count + counterpart_name
- [ ] Thread exibe mensagens, envia texto, atualiza em tempo real via WS
- [ ] Modal de diretório permite busca + convidar outra clínica
- [ ] Painel de convites incoming permite aceitar/rejeitar
- [ ] Badge de unread no item "Chat" do sidebar principal
- [ ] 59 testes da Phase 2 continuam passando (zero regressão)
- [ ] Smoke manual E2E cobre fluxo completo entre 2 admins de clínicas diferentes
- [ ] Branch pushada

## Próximas fases

| Fase | Escopo | Branch |
|---|---|---|
| 4 | Anexo análise IA anonimizada | `feat/chat-phase4-ai-attach` |
| 5 | Pipeline PII + anexo PDF/imagem | `feat/chat-phase5-pii-attach` |
| 6 | Reações + search UI + badge refinado | `feat/chat-phase6-polish` |
| 7 | Anti-abuso (email notify + denúncia UX) | `feat/chat-phase7-antiabuse` |
| 8 | E2E + audit log + mobile responsive | `feat/chat-phase8-final` |
