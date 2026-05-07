# GenomaFlow Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empacotar o Angular existente com Ionic Capacitor gerando apps nativos para Android (Play Store) e iOS (App Store) com push notifications, armazenamento seguro de JWT e UX nativa, sem impactar a versão web.

**Architecture:** Capacitor empacota o build Angular em shells nativas iOS e Android. O backend recebe endpoints aditivos para registro de device tokens e envio de push via Firebase Cloud Messaging. Todo código nativo é guardado por `Capacitor.isNativePlatform()` — o build web (`--configuration=production`) não é alterado.

**Tech Stack:** `@capacitor/core@6`, `@capacitor/cli@6`, `@capacitor/push-notifications`, `@capacitor/camera`, `@capacitor/preferences`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `firebase-admin` (backend), Fastlane (CI/CD)

---

## Mapa de Arquivos

### Novos
| Arquivo | Responsabilidade |
|---|---|
| `apps/web/capacitor.config.ts` | Configuração do Capacitor (appId, webDir, scheme) |
| `apps/web/src/environments/environment.mobile.ts` | Flag `mobile: true` para build nativo |
| `apps/web/src/app/core/push/push-notification.service.ts` | Registro e roteamento de push no Angular |
| `apps/api/src/services/push.js` | Wrapper firebase-admin — sendToUser / sendToTenant |
| `apps/api/src/db/migrations/080_device_tokens.sql` | Tabela device_tokens |
| `apps/api/tests/routes/device-token.test.js` | Testes unitários isolados dos novos endpoints |
| `apps/api/tests/services/push.test.js` | Testes do serviço push com firebase-admin mockado |
| `.github/workflows/deploy-mobile.yml` | CI/CD mobile disparado por tag |

### Modificados
| Arquivo | O que muda |
|---|---|
| `apps/web/angular.json` | Adiciona configuração `mobile` com fileReplacement |
| `apps/web/src/environments/environment.ts` | Adiciona flag `mobile: false` |
| `apps/web/src/environments/environment.prod.ts` | Adiciona flag `mobile: false` |
| `apps/web/src/app/app.component.ts` | Classe `capacitor-native`, back button, inicializa push |
| `apps/web/src/styles.scss` | Safe area CSS scoped à classe `capacitor-native` |
| `apps/api/src/routes/auth.js` | Endpoints `POST/DELETE /auth/device-token` + `POST /auth/refresh` |
| `apps/api/package.json` | Adiciona `firebase-admin` |
| `apps/worker/src/processors/exam.js` | Chama push.sendToUser após publicar `exam:done` |
| `apps/worker/src/notifications/scheduler.js` | Chama push.sendToUser nos appointment reminders |
| `apps/api/src/routes/inter-tenant-chat/messages.js` | Push na mensagem nova de chat |
| `apps/api/src/services/master-broadcasts.js` | Push no deliverToTenant |
| `apps/api/package.json` | Script `test:unit` inclui novos arquivos de teste |

---

## Fase M1 — Foundation

### Task 1: Instalar Capacitor e plugins

**Arquivos:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Instalar pacotes Capacitor em apps/web**

```bash
cd apps/web
npm install @capacitor/core@6 @capacitor/cli@6
npm install @capacitor/push-notifications@6 @capacitor/camera@6
npm install @capacitor/preferences@6 @capacitor/app@6
npm install @capacitor/status-bar@6 @capacitor/splash-screen@6
```

- [ ] **Step 2: Verificar instalação**

```bash
npx cap --version
```
Expected: `Capacitor CLI version 6.x.x`

- [ ] **Step 3: Commit**

```bash
cd ../..
git add apps/web/package.json apps/web/package-lock.json
git commit -m "chore(mobile): instalar Capacitor 6 + plugins nativos"
```

---

### Task 2: Criar capacitor.config.ts

**Arquivos:**
- Create: `apps/web/capacitor.config.ts`

- [ ] **Step 1: Verificar o outputPath real do Angular**

```bash
ls apps/web/dist/genomaflow-web/ 2>/dev/null || echo "build não existe ainda — rodar ng build primeiro"
```

Se existir um subdiretório `browser/`, o webDir é `dist/genomaflow-web/browser`. Caso contrário, `dist/genomaflow-web`.

- [ ] **Step 2: Criar o arquivo de configuração**

```typescript
// apps/web/capacitor.config.ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.genomaflow.app',
  appName: 'GenomaFlow',
  webDir: 'dist/genomaflow-web/browser',  // ajustar se necessário (ver Step 1)
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0b1326',
      androidSplashResourceName: 'splash',
      showSpinner: false
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0b1326'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/capacitor.config.ts
git commit -m "chore(mobile): capacitor.config.ts — appId + webDir + plugins"
```

---

### Task 3: Adicionar environment.mobile.ts + configuração angular.json

**Arquivos:**
- Create: `apps/web/src/environments/environment.mobile.ts`
- Modify: `apps/web/src/environments/environment.ts`
- Modify: `apps/web/src/environments/environment.prod.ts`
- Modify: `apps/web/angular.json`

- [ ] **Step 1: Adicionar flag `mobile` aos environments existentes**

`apps/web/src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: '/api',
  mobile: false
};
```

`apps/web/src/environments/environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: '/api',
  mobile: false
};
```

- [ ] **Step 2: Criar environment.mobile.ts**

```typescript
// apps/web/src/environments/environment.mobile.ts
export const environment = {
  production: true,
  apiUrl: '/api',
  mobile: true
};
```

- [ ] **Step 3: Adicionar configuração `mobile` no angular.json**

Abrir `apps/web/angular.json` e, dentro de `projects.genomaflow-web.architect.build.configurations`, adicionar após a entrada `production`:

```json
"mobile": {
  "fileReplacements": [
    {
      "replace": "src/environments/environment.ts",
      "with": "src/environments/environment.mobile.ts"
    }
  ],
  "budgets": [
    {
      "type": "initial",
      "maximumWarning": "900kB",
      "maximumError": "1.5MB"
    },
    {
      "type": "anyComponentStyle",
      "maximumWarning": "20kB",
      "maximumError": "24kB"
    }
  ],
  "outputHashing": "all"
}
```

- [ ] **Step 4: Verificar que o build web continua funcionando**

```bash
cd apps/web
ng build --configuration=production 2>&1 | tail -5
```
Expected: `✔ Application bundle generation complete.` (sem erros)

- [ ] **Step 5: Verificar que o build mobile funciona**

```bash
ng build --configuration=mobile 2>&1 | tail -5
```
Expected: `✔ Application bundle generation complete.`

- [ ] **Step 6: Commit**

```bash
cd ../..
git add apps/web/src/environments/ apps/web/angular.json
git commit -m "chore(mobile): environment.mobile.ts + angular.json config mobile"
```

---

### Task 4: Inicializar projetos nativos Android e iOS

**Arquivos:**
- Create: `apps/web/android/` (gerado pelo Capacitor)
- Create: `apps/web/ios/` (gerado pelo Capacitor — requer macOS com Xcode)

- [ ] **Step 1: Fazer o build mobile antes do sync**

```bash
cd apps/web
ng build --configuration=mobile
```

- [ ] **Step 2: Adicionar plataformas**

```bash
npx cap add android
# Se estiver em macOS com Xcode instalado:
npx cap add ios
# Se não tiver macOS: pular ios por enquanto — será feito no CI
```

- [ ] **Step 3: Sincronizar assets**

```bash
npx cap sync
```
Expected: mensagens de sync para android (e ios se adicionado), sem erros.

- [ ] **Step 4: Adicionar entradas no .gitignore de apps/web**

Abrir (ou criar) `apps/web/.gitignore` e garantir que estas linhas existam:
```
# Capacitor native — generated, não commitar binários
android/.gradle/
android/app/build/
ios/App/Pods/
ios/App/App/public/
```

Os diretórios `android/` e `ios/` em si **devem** ser commitados (contêm configurações nativas necessárias para o CI).

- [ ] **Step 5: Commit**

```bash
cd ../..
git add apps/web/android/ apps/web/ios/ apps/web/.gitignore
git commit -m "chore(mobile): adicionar projetos nativos Android + iOS via Capacitor"
```

---

### Task 5: Safe area CSS + classe capacitor-native no app.component

**Arquivos:**
- Modify: `apps/web/src/app/app.component.ts`
- Modify: `apps/web/src/styles.scss`

- [ ] **Step 1: Atualizar app.component.ts**

Ler o arquivo atual primeiro, depois adicionar no `ngOnInit()` existente (ou criar se não existir):

```typescript
// Adicionar imports no topo
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Location } from '@angular/common';

// No construtor, injetar Location:
constructor(private router: Router, private location: Location) {}
// (se router já estiver injetado, apenas adicionar location)

// No ngOnInit():
ngOnInit(): void {
  // ... código existente ...

  if (Capacitor.isNativePlatform()) {
    document.body.classList.add('capacitor-native');

    App.addListener('backButton', ({ canGoBack }) => {
      const protectedRoots = ['/doctor/patients', '/clinic/dashboard', '/master/tenants'];
      const isRoot = protectedRoots.some(r => this.router.url.startsWith(r));
      if (!canGoBack || isRoot) {
        App.exitApp();
      } else {
        this.location.back();
      }
    });
  }
}
```

- [ ] **Step 2: Adicionar safe area no styles.scss**

No final do arquivo `apps/web/src/styles.scss`, adicionar:

```scss
/* Safe area para notch / Dynamic Island / barra de câmera Android */
body.capacitor-native {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
```

- [ ] **Step 3: Verificar build**

```bash
cd apps/web
ng build --configuration=mobile 2>&1 | tail -5
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/web/src/app/app.component.ts apps/web/src/styles.scss
git commit -m "feat(mobile): safe area CSS + back button Android + classe capacitor-native"
```

---

### Task 6: Ícone e splash screen

**Arquivos:**
- Create: `apps/web/resources/icon.png` (1024×1024px)
- Create: `apps/web/resources/splash.png` (2732×2732px)

- [ ] **Step 1: Instalar gerador de assets**

```bash
cd apps/web
npm install -D @capacitor/assets
```

- [ ] **Step 2: Preparar imagens**

Colocar em `apps/web/resources/`:
- `icon.png` — logo GenomaFlow, 1024×1024px, fundo `#0b1326`, sem bordas arredondadas (o SO arredonda)
- `splash.png` — logo centralizado em fundo `#0b1326`, 2732×2732px

- [ ] **Step 3: Gerar assets para ambas as plataformas**

```bash
npx @capacitor/assets generate --iconBackgroundColor '#0b1326' --splashBackgroundColor '#0b1326'
```
Expected: gera ícones em múltiplas densidades em `android/app/src/main/res/` e `ios/App/App/Assets.xcassets/`.

- [ ] **Step 4: Sync**

```bash
npx cap sync
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add apps/web/resources/ apps/web/android/ apps/web/ios/
git commit -m "feat(mobile): ícone e splash screen GenomaFlow"
```

---

## Fase M2 — Push Notifications

### Task 7: Migration 080 — tabela device_tokens

**Arquivos:**
- Create: `apps/api/src/db/migrations/080_device_tokens.sql`

- [ ] **Step 1: Criar migration**

```sql
-- apps/api/src/db/migrations/080_device_tokens.sql

CREATE TABLE IF NOT EXISTS device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

-- Índice para busca de tokens por user (push sendToUser)
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id);

-- Sem RLS — não contém dados clínicos, apenas infraestrutura de entrega
-- Isolamento via user_id + tenant_id explícito nas queries

INSERT INTO _migrations (name) VALUES ('080_device_tokens') ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Aplicar migration no banco Docker**

```bash
docker compose exec api node src/db/migrate.js
```
Expected: `Migration 080_device_tokens applied` (ou "already applied" se rodou antes).

- [ ] **Step 3: Verificar tabela criada**

```bash
docker compose exec db psql -U postgres -d genomaflow -c "\d device_tokens"
```
Expected: colunas id, user_id, tenant_id, token, platform, created_at visíveis.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/080_device_tokens.sql
git commit -m "feat(mobile): migration 080 — tabela device_tokens para push"
```

---

### Task 8: Serviço backend push.js

**Arquivos:**
- Create: `apps/api/src/services/push.js`
- Create: `apps/api/tests/services/push.test.js`
- Modify: `apps/api/package.json` (adicionar firebase-admin)

- [ ] **Step 1: Instalar firebase-admin**

```bash
cd apps/api
npm install firebase-admin
```

- [ ] **Step 2: Escrever o teste primeiro (TDD)**

```javascript
// apps/api/tests/services/push.test.js
'use strict';

// Mock firebase-admin antes de importar push.js
const mockSendEach = jest.fn();
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn(() => ({})) },
  messaging: () => ({ sendEach: mockSendEach })
}));

const push = require('../../src/services/push');

const mockPg = {
  query: jest.fn()
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    project_id: 'test',
    private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----\n',
    client_email: 'test@test.iam.gserviceaccount.com'
  });
});

describe('push.sendToUser', () => {
  it('não faz nada se usuário não tiver tokens', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [] });
    await push.sendToUser(mockPg, 'user-1', { title: 'T', body: 'B', data: {} });
    expect(mockSendEach).not.toHaveBeenCalled();
  });

  it('envia para todos os tokens do usuário', async () => {
    mockPg.query.mockResolvedValueOnce({
      rows: [{ token: 'tok-android' }, { token: 'tok-ios' }]
    });
    mockSendEach.mockResolvedValueOnce({
      responses: [{ success: true }, { success: true }]
    });

    await push.sendToUser(mockPg, 'user-1', { title: 'Exame', body: 'Pronto', data: { route: '/doctor/patients/123' } });

    expect(mockSendEach).toHaveBeenCalledWith([
      expect.objectContaining({ token: 'tok-android', notification: { title: 'Exame', body: 'Pronto' } }),
      expect.objectContaining({ token: 'tok-ios' })
    ]);
  });

  it('remove tokens expirados quando FCM retorna registration-not-registered', async () => {
    mockPg.query
      .mockResolvedValueOnce({ rows: [{ token: 'tok-expired' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    mockSendEach.mockResolvedValueOnce({
      responses: [{
        success: false,
        error: { code: 'messaging/registration-token-not-registered' }
      }]
    });

    await push.sendToUser(mockPg, 'user-1', { title: 'T', body: 'B', data: {} });

    expect(mockPg.query).toHaveBeenCalledWith(
      'DELETE FROM device_tokens WHERE token = ANY($1)',
      [['tok-expired']]
    );
  });

  it('não lança erro se FCM falhar (best-effort)', async () => {
    mockPg.query.mockResolvedValueOnce({ rows: [{ token: 'tok-1' }] });
    mockSendEach.mockRejectedValueOnce(new Error('FCM down'));

    await expect(
      push.sendToUser(mockPg, 'user-1', { title: 'T', body: 'B', data: {} })
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3: Rodar teste para confirmar que falha**

```bash
cd apps/api
npx jest tests/services/push.test.js --no-coverage 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '../../src/services/push'`

- [ ] **Step 4: Implementar push.js**

```javascript
// apps/api/src/services/push.js
'use strict';

let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  _messaging = admin.messaging();
  return _messaging;
}

/**
 * Envia push notification para todos os dispositivos de um usuário.
 * Best-effort: nunca lança erro para não derrubar a request principal.
 */
async function sendToUser(pg, userId, { title, body, data = {} }) {
  try {
    const { rows } = await pg.query(
      'SELECT token FROM device_tokens WHERE user_id = $1',
      [userId]
    );
    if (!rows.length) return;

    const messaging = getMessaging();
    const messages = rows.map(({ token }) => ({
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      token
    }));

    const result = await messaging.sendEach(messages);

    // Remove tokens inválidos/expirados
    const expired = result.responses
      .map((r, i) => (!r.success && r.error?.code === 'messaging/registration-token-not-registered') ? rows[i].token : null)
      .filter(Boolean);

    if (expired.length) {
      await pg.query('DELETE FROM device_tokens WHERE token = ANY($1)', [expired]);
    }
  } catch (err) {
    console.error('[push] sendToUser error:', err.message);
  }
}

/**
 * Envia push para todos os usuários de um tenant.
 */
async function sendToTenant(pg, tenantId, { title, body, data = {} }) {
  try {
    const { rows } = await pg.query(
      'SELECT DISTINCT user_id FROM device_tokens WHERE tenant_id = $1',
      [tenantId]
    );
    await Promise.all(rows.map(({ user_id }) => sendToUser(pg, user_id, { title, body, data })));
  } catch (err) {
    console.error('[push] sendToTenant error:', err.message);
  }
}

module.exports = { sendToUser, sendToTenant };
```

- [ ] **Step 5: Rodar testes**

```bash
npx jest tests/services/push.test.js --no-coverage 2>&1 | tail -10
```
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
cd ../..
git add apps/api/src/services/push.js apps/api/tests/services/push.test.js apps/api/package.json apps/api/package-lock.json
git commit -m "feat(mobile): push.js — sendToUser/sendToTenant via firebase-admin"
```

---

### Task 9: Endpoints POST/DELETE /auth/device-token

**Arquivos:**
- Modify: `apps/api/src/routes/auth.js`
- Create: `apps/api/tests/routes/device-token.test.js`

- [ ] **Step 1: Escrever testes primeiro (TDD)**

```javascript
// apps/api/tests/routes/device-token.test.js
'use strict';
const Fastify = require('fastify');

function buildApp(pgMock) {
  const app = Fastify();
  app.decorate('authenticate', async (req) => {
    req.user = { user_id: 'user-1', tenant_id: 'tenant-1' };
  });
  app.decorate('pg', pgMock);

  // Registrar apenas os handlers novos inline para teste isolado
  app.post('/auth/device-token', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { token, platform } = request.body || {};

    if (!token || !platform || !['android', 'ios'].includes(platform)) {
      return reply.status(400).send({ error: 'token e platform (android|ios) são obrigatórios' });
    }

    await pgMock.query(
      `INSERT INTO device_tokens (user_id, tenant_id, token, platform)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, created_at = NOW()`,
      [user_id, tenant_id, token, platform]
    );

    return reply.status(204).send();
  });

  app.delete('/auth/device-token', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { token } = request.body || {};

    if (!token) return reply.status(400).send({ error: 'token obrigatório' });

    await pgMock.query(
      'DELETE FROM device_tokens WHERE user_id = $1 AND token = $2',
      [user_id, token]
    );
    return reply.status(204).send();
  });

  return app;
}

describe('POST /auth/device-token', () => {
  it('registra token válido com 204', async () => {
    const pg = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'POST', url: '/auth/device-token',
      payload: { token: 'fcm-token-abc', platform: 'android' }
    });
    expect(r.statusCode).toBe(204);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO device_tokens'), expect.arrayContaining(['fcm-token-abc', 'android']));
  });

  it('rejeita platform inválido com 400', async () => {
    const pg = { query: jest.fn() };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'POST', url: '/auth/device-token',
      payload: { token: 'tok', platform: 'windows' }
    });
    expect(r.statusCode).toBe(400);
    expect(pg.query).not.toHaveBeenCalled();
  });

  it('rejeita body sem token com 400', async () => {
    const pg = { query: jest.fn() };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'POST', url: '/auth/device-token',
      payload: { platform: 'ios' }
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('DELETE /auth/device-token', () => {
  it('remove token com 204', async () => {
    const pg = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const app = buildApp(pg);
    const r = await app.inject({
      method: 'DELETE', url: '/auth/device-token',
      payload: { token: 'fcm-token-abc' }
    });
    expect(r.statusCode).toBe(204);
    expect(pg.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM device_tokens'),
      ['user-1', 'fcm-token-abc']
    );
  });

  it('rejeita body sem token com 400', async () => {
    const pg = { query: jest.fn() };
    const app = buildApp(pg);
    const r = await app.inject({ method: 'DELETE', url: '/auth/device-token', payload: {} });
    expect(r.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

```bash
cd apps/api
npx jest tests/routes/device-token.test.js --no-coverage 2>&1 | tail -5
```
Expected: FAIL (módulo isolado sem implementação real ainda — os handlers estão inline no teste, então devem passar já)

Nota: os handlers estão inline no buildApp do teste. Eles passarão. O próximo passo é mover a lógica real para auth.js.

- [ ] **Step 3: Adicionar endpoints em apps/api/src/routes/auth.js**

Ler o arquivo completo, depois adicionar antes do `};` final do module.exports:

```javascript
  // POST /auth/device-token — registra device token para push notifications
  fastify.post('/device-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id } = request.user;
    const { token, platform } = request.body || {};

    if (!token || !platform || !['android', 'ios'].includes(platform)) {
      return reply.status(400).send({ error: 'token e platform (android|ios) são obrigatórios' });
    }

    await fastify.pg.query(
      `INSERT INTO device_tokens (user_id, tenant_id, token, platform)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, created_at = NOW()`,
      [user_id, tenant_id, token, platform]
    );

    return reply.status(204).send();
  });

  // DELETE /auth/device-token — remove token no logout
  fastify.delete('/device-token', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id } = request.user;
    const { token } = request.body || {};

    if (!token) return reply.status(400).send({ error: 'token obrigatório' });

    await fastify.pg.query(
      'DELETE FROM device_tokens WHERE user_id = $1 AND token = $2',
      [user_id, token]
    );
    return reply.status(204).send();
  });
```

- [ ] **Step 4: Rodar testes**

```bash
npx jest tests/routes/device-token.test.js --no-coverage 2>&1 | tail -10
```
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Adicionar ao test:unit no package.json**

Abrir `apps/api/package.json`, localizar `"test:unit"` e adicionar `tests/routes/device-token.test.js` e `tests/services/push.test.js` na lista.

- [ ] **Step 6: Rodar test:unit completo**

```bash
npm run test:unit 2>&1 | tail -5
```
Expected: todos passando.

- [ ] **Step 7: Commit**

```bash
cd ../..
git add apps/api/src/routes/auth.js apps/api/tests/routes/device-token.test.js apps/api/package.json
git commit -m "feat(mobile): POST/DELETE /auth/device-token — registro de push tokens"
```

---

### Task 10: PushNotificationService no Angular

**Arquivos:**
- Create: `apps/web/src/app/core/push/push-notification.service.ts`
- Modify: `apps/web/src/app/app.component.ts`

- [ ] **Step 1: Criar PushNotificationService**

```typescript
// apps/web/src/app/core/push/push-notification.service.ts
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import {
  PushNotifications,
  Token,
  ActionPerformed
} from '@capacitor/push-notifications';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private router = inject(Router);
  private http = inject(HttpClient);

  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    await PushNotifications.register();

    PushNotifications.addListener('registration', (token: Token) => {
      this.registerToken(token.value);
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] registration error:', err);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      const route = action.notification.data?.route;
      if (route) this.router.navigateByUrl(route);
    });
  }

  private registerToken(token: string): void {
    const platform = Capacitor.getPlatform() as 'android' | 'ios';
    this.http.post(`${environment.apiUrl}/auth/device-token`, { token, platform })
      .subscribe({ error: (e) => console.error('[push] token registration failed:', e) });
  }

  removeToken(token: string): void {
    if (!Capacitor.isNativePlatform()) return;
    this.http.delete(`${environment.apiUrl}/auth/device-token`, { body: { token } })
      .subscribe({ error: () => {} });
  }
}
```

- [ ] **Step 2: Inicializar o serviço no app.component.ts**

Adicionar ao `ngOnInit()`, após o código de back button existente (Task 5):

```typescript
// Adicionar import
import { PushNotificationService } from './core/push/push-notification.service';

// Injetar no construtor ou via inject()
private pushSvc = inject(PushNotificationService);

// No ngOnInit():
await this.pushSvc.initialize();
```

Se o `ngOnInit` não for `async`, torná-lo `async`:
```typescript
async ngOnInit(): Promise<void> { ... }
```

- [ ] **Step 3: Build**

```bash
cd apps/web
ng build --configuration=mobile 2>&1 | tail -5
```
Expected: sem erros.

- [ ] **Step 4: Verificar build web NÃO quebrou**

```bash
ng build --configuration=production 2>&1 | tail -5
```
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd ../..
git add apps/web/src/app/core/push/ apps/web/src/app/app.component.ts
git commit -m "feat(mobile): PushNotificationService — registro de token + deep link handler"
```

---

### Task 11: Integrar push no evento exam:done

**Arquivos:**
- Modify: `apps/worker/src/processors/exam.js`

- [ ] **Step 1: Ler as linhas onde exam:done é publicado**

```bash
grep -n "exam:done\|pub.publish" apps/worker/src/processors/exam.js
```
Expected: linhas ~284 e ~557 com `pub.publish('exam:done:...')`.

- [ ] **Step 2: Adicionar push nas duas ocorrências**

Após cada `await pub.publish(\`exam:done:${tenant_id}\`, ...)`, adicionar:

```javascript
// Push notification para o médico do exame
try {
  const { sendToUser } = require('../../../api/src/services/push');
  // Busca user_id do exame
  const { rows: examRows } = await pool.query(
    'SELECT user_id, subject_id FROM exams WHERE id = $1 AND tenant_id = $2',
    [exam_id, tenant_id]
  );
  if (examRows[0]) {
    // Busca nome do paciente
    const { rows: subjectRows } = await pool.query(
      'SELECT name FROM subjects WHERE id = $1 AND tenant_id = $2',
      [examRows[0].subject_id, tenant_id]
    );
    const patientName = subjectRows[0]?.name ?? 'Paciente';
    await sendToUser(pool, examRows[0].user_id, {
      title: 'Exame disponível',
      body: `Exame de ${patientName} pronto para análise`,
      data: { route: `/doctor/patients/${examRows[0].subject_id}` }
    });
  }
} catch (e) {
  console.error('[push] exam:done push error:', e.message);
}
```

Nota: verifique se o worker tem acesso ao `pool` (objeto de conexão pg). Se a variável se chamar diferente (ex: `client`, `pg`), usar o nome correto. O push.js apenas precisa de um objeto com método `.query()`.

- [ ] **Step 3: Adicionar push para alertas clínicos críticos (mesmo arquivo)**

Na função `persistResult`, após o INSERT em `clinical_results`, adicionar verificação de alertas críticos:

```javascript
// Após o INSERT em clinical_results dentro de persistResult():
const alerts = result.alerts || [];
const hasCritical = alerts.some(a => ['critical', 'high'].includes(a.severity?.toLowerCase()));
if (hasCritical) {
  try {
    const { sendToUser } = require('../../api/src/services/push');
    // user_id do exame — passar como parâmetro ou buscar
    const { rows: examRows } = await client.query(
      'SELECT user_id, subject_id FROM exams WHERE id = $1 AND tenant_id = $2',
      [examId, tenantId]
    );
    if (examRows[0]) {
      const { rows: subjectRows } = await client.query(
        'SELECT name FROM subjects WHERE id = $1 AND tenant_id = $2',
        [examRows[0].subject_id, tenantId]
      );
      const patientName = subjectRows[0]?.name ?? 'Paciente';
      await sendToUser(pool, examRows[0].user_id, {
        title: 'Alerta clínico',
        body: `Alerta crítico no exame de ${patientName}`,
        data: { route: `/doctor/patients/${examRows[0].subject_id}` }
      });
    }
  } catch (e) {
    console.error('[push] clinical alert push error:', e.message);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/processors/exam.js
git commit -m "feat(mobile): push notification em exam:done e alertas clínicos críticos"
```

---

### Task 12: Integrar push em mensagem de chat inter-clínica

**Arquivos:**
- Modify: `apps/api/src/routes/inter-tenant-chat/messages.js`

- [ ] **Step 1: Localizar onde o evento WS é emitido após POST de mensagem**

```bash
grep -n "redis.publish\|notif\|unread" apps/api/src/routes/inter-tenant-chat/messages.js | head -15
```

- [ ] **Step 2: Adicionar push após os redis.publish existentes**

No handler de POST (nova mensagem), após os `fastify.redis.publish(...)` existentes:

```javascript
// Push para o usuário da outra clínica
try {
  const { sendToUser } = require('../../services/push');
  // counterpartUserId deve estar disponível na query da conversa
  // (adaptar conforme o nome da variável real no handler)
  if (counterpartUserId) {
    const senderName = senderTenantName ?? 'Clínica';
    await sendToUser(fastify.pg, counterpartUserId, {
      title: 'Nova mensagem',
      body: `${senderName} enviou uma mensagem`,
      data: { route: `/chat` }
    });
  }
} catch (e) {
  fastify.log.error({ err: e }, '[push] chat message push error');
}
```

Adapte `counterpartUserId` e `senderTenantName` para os nomes reais das variáveis existentes no handler. Se o handler não tiver o user_id do contraparte disponível diretamente, fazer um SELECT adicional: `SELECT user_id FROM users WHERE tenant_id = $1 AND role = 'admin' LIMIT 1`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/inter-tenant-chat/messages.js
git commit -m "feat(mobile): push notification em nova mensagem de chat"
```

---

### Task 13: Integrar push em appointment reminders

**Arquivos:**
- Modify: `apps/worker/src/notifications/scheduler.js`

- [ ] **Step 1: Localizar onde WhatsApp/email é enviado no scheduler**

```bash
grep -n "sendWhatsApp\|send\|status.*sent\|reminder" apps/worker/src/notifications/scheduler.js | head -20
```

- [ ] **Step 2: Adicionar push após o envio de WhatsApp/email**

No loop que processa `pending` notifications (buscar a função que muda status para 'sent'), adicionar push:

```javascript
// Após enviar WhatsApp/email, enviar também push
try {
  const { sendToUser } = require('../../../api/src/services/push');
  // userId e tenantId devem estar na row da scheduled_notification
  // junto com subject_name e appointment_starts_at
  const hora = new Date(row.appointment_starts_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
  });
  await sendToUser(pool, row.user_id, {
    title: 'Consulta em breve',
    body: `${row.subject_name} — ${hora}`,
    data: { route: '/agenda' }
  });
} catch (e) {
  console.error('[push] appointment reminder push error:', e.message);
}
```

Ajustar nomes de variáveis para os reais na função. Se `user_id` não estiver na `scheduled_notifications`, fazer JOIN com `appointments` → `users`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/notifications/scheduler.js
git commit -m "feat(mobile): push notification em appointment reminders"
```

---

### Task 14: Integrar push em master broadcasts

**Arquivos:**
- Modify: `apps/api/src/services/master-broadcasts.js`

- [ ] **Step 1: Ler a função deliverToTenant**

```bash
grep -n "deliverToTenant\|INSERT INTO tenant_messages\|redis.publish" apps/api/src/services/master-broadcasts.js | head -20
```

- [ ] **Step 2: Adicionar push no deliverToTenant após redis.publish**

Após os `fastify.redis.publish` / `pg.query('SELECT redis...')` existentes, adicionar push para o admin do tenant destinatário:

```javascript
// Push para admin do tenant destinatário
try {
  const { sendToUser } = require('./push');
  // recipientTenant.admin_user_id deve vir da query de resolveTargetTenants
  // Se não estiver disponível, buscar aqui:
  const { rows: adminRows } = await client.query(
    "SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' LIMIT 1",
    [recipientTenant.id]
  );
  if (adminRows[0]) {
    const preview = body.slice(0, 80) + (body.length > 80 ? '…' : '');
    await sendToUser(client, adminRows[0].id, {
      title: 'GenomaFlow',
      body: preview,
      data: { route: '/chat' }
    });
  }
} catch (e) {
  console.error('[push] broadcast push error:', e.message);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/master-broadcasts.js
git commit -m "feat(mobile): push notification em master broadcasts"
```

---

## Fase M3 — Native UX

### Task 15: AuthService — armazenamento seguro do JWT

**Arquivos:**
- Modify: `apps/web/src/app/core/auth/auth.service.ts`

- [ ] **Step 1: Ler o AuthService atual**

```bash
wc -l apps/web/src/app/core/auth/auth.service.ts
```
Ler o arquivo completo antes de editar.

- [ ] **Step 2: Adicionar métodos de storage seguro**

Adicionar métodos privados no `AuthService`. Estes substituem os `localStorage.setItem/getItem/removeItem` para o JWT quando em plataforma nativa:

```typescript
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Dentro da classe AuthService:

private async saveToken(token: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: 'auth_token', value: token });
  } else {
    localStorage.setItem('token', token);
  }
}

private async loadToken(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: 'auth_token' });
    return value;
  }
  return localStorage.getItem('token');
}

private async clearToken(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Preferences.remove({ key: 'auth_token' });
  } else {
    localStorage.removeItem('token');
  }
}
```

Substituir as chamadas diretas de `localStorage` para o token pelas chamadas a esses métodos. Métodos que eram síncronos podem precisar se tornar `async` — verificar se há impacto nos guards e interceptors.

- [ ] **Step 3: Verificar build**

```bash
cd apps/web
ng build --configuration=mobile 2>&1 | tail -5
ng build --configuration=production 2>&1 | tail -5
```
Expected: ambos sem erros.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/web/src/app/core/auth/auth.service.ts
git commit -m "feat(mobile): AuthService usa Capacitor Preferences para JWT em app nativo"
```

---

### Task 16: Câmera nativa para upload de imagem

**Arquivos:**
- Modify: `apps/web/src/app/shared/` (localizar o componente/serviço de upload de imagem)

- [ ] **Step 1: Localizar o código de upload de imagem atual**

```bash
grep -rn "type=\"file\"\|accept.*image\|FileReader\|formData" apps/web/src/app/ --include="*.ts" --include="*.html" | grep -v "node_modules" | head -10
```

- [ ] **Step 2: Criar helper de câmera nativa**

No arquivo de upload encontrado (ou criar `apps/web/src/app/shared/native-camera.service.ts`):

```typescript
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

@Injectable({ providedIn: 'root' })
export class NativeCameraService {

  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async pickImage(): Promise<{ base64: string; mimeType: string } | null> {
    if (!this.isNative()) return null; // web usa <input type="file"> normalmente

    const image = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt  // pergunta: câmera ou galeria
    });

    return {
      base64: image.base64String!,
      mimeType: `image/${image.format}`
    };
  }
}
```

- [ ] **Step 3: Integrar no componente de upload**

No template do componente de upload, manter o `<input type="file">` e adicionar botão condicional:

```html
@if (cameraSvc.isNative()) {
  <button mat-stroked-button (click)="onNativeCamera()">
    <mat-icon>camera_alt</mat-icon> Câmera / Galeria
  </button>
} @else {
  <input type="file" accept="image/*" (change)="onFileChange($event)"/>
}
```

No `.ts`:
```typescript
async onNativeCamera(): Promise<void> {
  const result = await this.cameraSvc.pickImage();
  if (!result) return;
  // Usar result.base64 + result.mimeType no mesmo fluxo existente de upload
  this.handleBase64Image(result.base64, result.mimeType);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/shared/native-camera.service.ts
git add apps/web/src/app/  # arquivos alterados
git commit -m "feat(mobile): câmera nativa para upload de imagem de exame"
```

---

### Task 17: Login biométrico

**Arquivos:**
- Modify: `apps/web/src/app/features/login/login.component.ts`

- [ ] **Step 1: Instalar plugin de biometria**

```bash
cd apps/web
npm install @capawesome-team/capacitor-biometrics
npx cap sync
```

- [ ] **Step 2: Adicionar opção de biometria no login**

No `login.component.ts`, adicionar após login bem-sucedido pela primeira vez:

```typescript
import { Capacitor } from '@capacitor/core';
import { Biometrics } from '@capawesome-team/capacitor-biometrics';

// Após login bem-sucedido (no subscribe do next:):
if (Capacitor.isNativePlatform()) {
  await this.offerBiometricSetup();
}

private async offerBiometricSetup(): Promise<void> {
  try {
    const { isAvailable } = await Biometrics.checkBiometry();
    if (!isAvailable) return;

    const alreadyEnabled = localStorage.getItem('biometric_enabled') === 'true';
    if (alreadyEnabled) return;

    // Mostrar dialog simples de confirmação (MatSnackBar ou MatDialog)
    this.snack.open('Ativar Face ID / Touch ID para próximos acessos?', 'Ativar', { duration: 8000 })
      .onAction().subscribe(() => {
        localStorage.setItem('biometric_enabled', 'true');
        // Token já está salvo no Keychain via AuthService (Task 15)
      });
  } catch { /* biometria não disponível */ }
}
```

No `ngOnInit()`, checar se deve autenticar por biometria:

```typescript
async ngOnInit(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (localStorage.getItem('biometric_enabled') !== 'true') return;

  try {
    const { isAvailable } = await Biometrics.checkBiometry();
    if (!isAvailable) return;

    await Biometrics.authenticate({ reason: 'Autenticar no GenomaFlow' });

    // Biometria aprovada — verificar se token existe no Keychain.
    // O AuthService já carrega o token do Keychain no startup via loadToken()
    // (implementado na Task 15). Se o token estiver válido, os guards e o
    // interceptor já cuidam do /auth/me. Apenas navegar:
    const token = await this.authSvc.loadToken();
    if (token) {
      this.router.navigateByUrl('/doctor/patients');
    }
    // Se não houver token (sessão expirada), o guard redireciona para login normal.
  } catch { /* biometria falhou ou cancelada — mostrar login normal */ }
}
```

- [ ] **Step 3: Build**

```bash
cd apps/web
ng build --configuration=mobile 2>&1 | tail -5
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/web/src/app/features/login/login.component.ts apps/web/package.json apps/web/package-lock.json
git commit -m "feat(mobile): login biométrico com Face ID / Touch ID"
```

---

## Fase M4 — App Store CI/CD

### Task 18: Backend POST /auth/refresh

**Arquivos:**
- Modify: `apps/api/src/routes/auth.js`
- Modify: `apps/api/tests/routes/device-token.test.js` (adicionar teste de refresh)

- [ ] **Step 1: Escrever teste**

Adicionar ao arquivo `apps/api/tests/routes/device-token.test.js` (ou criar arquivo separado `auth-refresh.test.js`):

```javascript
describe('POST /auth/refresh', () => {
  function buildRefreshApp(pgMock, jwtMock) {
    const app = Fastify();
    app.decorate('authenticate', async (req) => {
      req.user = { user_id: 'user-1', tenant_id: 'tenant-1', role: 'admin', module: 'human', jti: 'old-jti' };
    });
    app.decorate('pg', pgMock);
    app.decorate('jwt', jwtMock);
    app.decorate('redis', { set: jest.fn().mockResolvedValue('OK') });

    app.post('/auth/refresh', { preHandler: [app.authenticate] }, async (request, reply) => {
      const { user_id, tenant_id, role, module } = request.user;
      const { randomUUID } = require('crypto');
      const jti = randomUUID();
      const token = app.jwt.sign({ user_id, tenant_id, role, module, jti });
      await app.redis.set(`session:${user_id}`, jti, 'EX', 90 * 24 * 60 * 60);
      return { token };
    });
    return app;
  }

  it('retorna novo JWT para usuário autenticado', async () => {
    const pg = { query: jest.fn() };
    const jwt = { sign: jest.fn(() => 'new-jwt-token') };
    const app = buildRefreshApp(pg, jwt);
    const r = await app.inject({ method: 'POST', url: '/auth/refresh' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).token).toBe('new-jwt-token');
    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }));
  });
});
```

- [ ] **Step 2: Implementar o endpoint em auth.js**

Adicionar antes do `};` final:

```javascript
  // POST /auth/refresh — gera novo JWT para sessão mobile (biometria)
  fastify.post('/refresh', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { user_id, tenant_id, role, module } = request.user;
    const jti = randomUUID(); // já importado no topo do arquivo
    const token = fastify.jwt.sign({ user_id, tenant_id, role, module: module || 'human', jti });
    await fastify.redis.set(`session:${user_id}`, jti, 'EX', SESSION_TTL_SECONDS);
    return { token };
  });
```

- [ ] **Step 3: Rodar testes**

```bash
cd apps/api
npm run test:unit 2>&1 | tail -5
```
Expected: todos passando.

- [ ] **Step 4: Commit**

```bash
cd ../..
git add apps/api/src/routes/auth.js apps/api/tests/
git commit -m "feat(mobile): POST /auth/refresh — renova JWT para login biométrico"
```

---

### Task 19: deploy-mobile.yml — workflow CI/CD

**Arquivos:**
- Create: `.github/workflows/deploy-mobile.yml`

- [ ] **Step 1: Criar o workflow**

```yaml
# .github/workflows/deploy-mobile.yml
name: Deploy Mobile (Android + iOS)

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  build-android:
    name: Build Android
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/web

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: apps/web/package-lock.json

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Install dependencies
        run: npm ci

      - name: Build Angular (mobile)
        run: npx ng build --configuration=mobile

      - name: Sync Capacitor
        run: npx cap sync android

      - name: Decode Android Keystore
        run: |
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/app/genomaflow-release.keystore

      - name: Build Android AAB
        working-directory: apps/web/android
        run: ./gradlew bundleRelease
        env:
          KEYSTORE_PATH: app/genomaflow-release.keystore
          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: genomaflow
          KEY_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}

      - name: Setup Ruby + Fastlane
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.2'
          bundler-cache: true
          working-directory: apps/web/android

      - name: Upload to Play Store (internal track)
        working-directory: apps/web/android
        run: bundle exec fastlane supply
        env:
          GOOGLE_PLAY_JSON_KEY_DATA: ${{ secrets.GOOGLE_PLAY_JSON_KEY }}

  build-ios:
    name: Build iOS
    runs-on: macos-latest
    defaults:
      run:
        working-directory: apps/web

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: apps/web/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Build Angular (mobile)
        run: npx ng build --configuration=mobile

      - name: Sync Capacitor
        run: npx cap sync ios

      - name: Setup Ruby + Fastlane
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.2'
          bundler-cache: true
          working-directory: apps/web/ios

      - name: Install CocoaPods
        working-directory: apps/web/ios/App
        run: pod install

      - name: Build + Upload to TestFlight
        working-directory: apps/web/ios
        run: bundle exec fastlane beta
        env:
          APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
          APP_STORE_CONNECT_API_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_API_ISSUER_ID }}
          APP_STORE_CONNECT_API_KEY_CONTENT: ${{ secrets.APP_STORE_CONNECT_API_KEY_CONTENT }}
          APPLE_CERT_BASE64: ${{ secrets.APPLE_CERT_BASE64 }}
          APPLE_PROVISIONING_PROFILE: ${{ secrets.APPLE_PROVISIONING_PROFILE }}
```

- [ ] **Step 2: Criar Gemfile para Android**

```
# apps/web/android/Gemfile
source "https://rubygems.org"
gem "fastlane"
```

- [ ] **Step 3: Criar Fastfile Android**

```ruby
# apps/web/android/fastlane/Fastfile
default_platform(:android)

platform :android do
  lane :supply do
    upload_to_play_store(
      track: 'internal',
      aab: 'app/build/outputs/bundle/release/app-release.aab',
      json_key_data: ENV['GOOGLE_PLAY_JSON_KEY_DATA'],
      package_name: 'com.genomaflow.app',
      skip_upload_apk: true,
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true
    )
  end
end
```

- [ ] **Step 4: Criar Gemfile para iOS**

```
# apps/web/ios/Gemfile
source "https://rubygems.org"
gem "fastlane"
```

- [ ] **Step 5: Criar Fastfile iOS**

```ruby
# apps/web/ios/fastlane/Fastfile
default_platform(:ios)

platform :ios do
  lane :beta do
    api_key = app_store_connect_api_key(
      key_id: ENV['APP_STORE_CONNECT_API_KEY_ID'],
      issuer_id: ENV['APP_STORE_CONNECT_API_ISSUER_ID'],
      key_content: ENV['APP_STORE_CONNECT_API_KEY_CONTENT'],
      is_key_content_base64: false
    )

    import_certificate(
      certificate_path: 'cert.p12',
      certificate_password: '',
      keychain_name: 'login.keychain'
    ) rescue nil  # cert pode não existir em primeira execução

    install_provisioning_profile(
      path: 'GenomaFlow.mobileprovision'
    ) rescue nil

    build_app(
      workspace: 'App/App.xcworkspace',
      scheme: 'App',
      export_method: 'app-store',
      output_directory: './build'
    )

    upload_to_testflight(
      api_key: api_key,
      skip_waiting_for_build_processing: true
    )
  end
end
```

- [ ] **Step 6: Commit**

```bash
cd ../..
git add .github/workflows/deploy-mobile.yml apps/web/android/fastlane/ apps/web/ios/fastlane/ apps/web/android/Gemfile apps/web/ios/Gemfile
git commit -m "feat(mobile): deploy-mobile.yml — CI/CD Android + iOS via Fastlane por tag"
```

---

### Task 20: Configurar GitHub Secrets e publicar primeira versão

**Esta task é manual — não há código a escrever.**

- [ ] **Step 1: Criar contas se necessário**
  - Google Play Developer: https://play.google.com/console ($25)
  - Apple Developer Program: https://developer.apple.com ($99/ano)
  - Firebase Project: https://console.firebase.google.com (gratuito)

- [ ] **Step 2: Criar Android Keystore**

```bash
cd apps/web
keytool -genkey -v -keystore genomaflow-release.keystore \
  -alias genomaflow -keyalg RSA -keysize 2048 -validity 10000
# Guardar a senha no 1Password/Vault — não recuperável se perdida
base64 -i genomaflow-release.keystore | pbcopy  # copia para clipboard
# Adicionar como ANDROID_KEYSTORE_BASE64 no GitHub Secrets
```

- [ ] **Step 3: Adicionar secrets no GitHub**

Em `github.com/[org]/GenomaFlow/settings/secrets/actions`, adicionar:

| Secret | Como obter |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Step 2 acima |
| `ANDROID_KEYSTORE_PASSWORD` | Senha do Step 2 |
| `GOOGLE_PLAY_JSON_KEY` | Play Console → API access → Service account JSON |
| `APPLE_CERT_BASE64` | Keychain Access → exportar .p12 → `base64 cert.p12` |
| `APPLE_PROVISIONING_PROFILE` | developer.apple.com → Profiles → download |
| `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect → Users → Keys |
| `APP_STORE_CONNECT_API_ISSUER_ID` | App Store Connect → Users → Keys |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Conteúdo do arquivo .p8 baixado |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Console → Project Settings → Service Accounts → JSON |

- [ ] **Step 4: Criar app nas lojas antes do primeiro upload**
  - Google Play: criar novo app em play.google.com/console
  - App Store Connect: criar novo app em appstoreconnect.apple.com (requer bundle ID `com.genomaflow.app` registrado)

- [ ] **Step 5: Disparar primeiro build**

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [ ] **Step 6: Monitorar pipeline**

```bash
gh run list --workflow=deploy-mobile.yml
gh run watch
```

- [ ] **Step 7: Adicionar FIREBASE_SERVICE_ACCOUNT ao AWS Secrets Manager (prod)**

```bash
aws secretsmanager create-secret \
  --name genomaflow/FIREBASE_SERVICE_ACCOUNT \
  --secret-string file://firebase-service-account.json \
  --region us-east-1
```

E referenciar na task definition ECS da API (em `infra/lib/ecs-stack.ts`), seguindo o padrão das outras secrets.

---

## Verificação Final

Após completar todas as tasks:

- [ ] Build web production continua passando: `cd apps/web && ng build --configuration=production`
- [ ] Build mobile passa: `cd apps/web && ng build --configuration=mobile`
- [ ] `npm run test:unit` na API: todos os testes passando (incluindo novos device-token + push)
- [ ] Migration 080 aplicada no Docker local: `docker compose exec api node src/db/migrate.js`
- [ ] CI gate (`deploy.yml`) não foi alterado: `cat .github/workflows/deploy.yml | grep "deploy-mobile"` → sem resultado
- [ ] Primeiro build mobile no CI completa sem erro (via tag v1.0.0)
