# GenomaFlow Mobile App — Design Spec

**Data:** 2026-05-07
**Abordagem escolhida:** Capacitor (Angular existente empacotado em shell nativa)
**Plataformas:** Android (Google Play) + iOS (Apple App Store)
**Constraint crítica:** nenhuma alteração pode afetar ou quebrar a versão web existente

---

## 1. Arquitetura Geral

Capacitor empacota o build Angular (`apps/web`) em projetos nativos iOS (Xcode) e Android (Android Studio). O backend (`apps/api`) não sofre alterações estruturais — apenas endpoints aditivos para device tokens e push.

### Estrutura de arquivos

```
apps/web/
  capacitor.config.ts         ← configuração Capacitor (novo)
  ios/                        ← projeto Xcode gerado (novo, gitignored parcialmente)
  android/                    ← projeto Android Studio gerado (novo, gitignored parcialmente)
  src/
    environments/
      environment.ts          ← adiciona flag: mobile: false (web dev)
      environment.prod.ts     ← adiciona flag: mobile: false (web prod)
      environment.mobile.ts   ← mobile: true, apiUrl: '/api' (novo)
```

### Build commands

| Target | Comando |
|---|---|
| Web (sem mudança) | `ng build --configuration=production` |
| Mobile | `ng build --configuration=mobile && npx cap sync` |
| iOS (Xcode) | `npx cap open ios` → Xcode faz o build/archive |
| Android | `npx cap open android` → Android Studio faz o build |

### Isolamento web ↔ mobile

- Build web (`--configuration=production`) não toca `ios/` nem `android/`
- Plugins Capacitor têm no-op automático quando rodando em browser
- Código nativo sempre guardado por `Capacitor.isNativePlatform()` — nunca executa no browser
- `deploy.yml` (web + API) não é alterado em nenhuma linha

### Plugins necessários

| Plugin | Uso |
|---|---|
| `@capacitor/push-notifications` | Push via FCM (Android) + APNs (iOS) |
| `@capacitor/camera` | Câmera + galeria para upload de exame |
| `@capacitor/preferences` | Armazenamento seguro do JWT (Keychain / EncryptedSharedPreferences) |
| `@capacitor/biometrics` | Face ID / Touch ID no login recorrente |
| `@capacitor/status-bar` | Cor da status bar sincronizada com tema do app |
| `@capacitor/splash-screen` | Splash screen com logo GenomaFlow |
| `@capacitor/app` | Back button Android + lifecycle events |

---

## 2. Push Notifications

Feature crítica para o caso de urgência: médico fora do consultório é notificado proativamente.

### Infraestrutura

- **Firebase Cloud Messaging (FCM):** cobre Android e iOS (via APNs bridge)
- **SDK backend:** `firebase-admin` no `apps/api`
- **Credenciais:** chave de serviço Firebase no AWS Secrets Manager (padrão do projeto)

### Fluxo de registro

```
App inicializa
→ solicita permissão de notificação ao usuário
→ FCM/APNs retorna device token único
→ POST /auth/device-token { token, platform: 'android'|'ios' }
→ API salva token na tabela device_tokens (vinculado ao user_id + tenant_id)

Logout:
→ DELETE /auth/device-token
→ token removido — sem push após logout
```

### Schema (migration nova)

```sql
CREATE TABLE device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);
-- RLS: tenant_id padrão do projeto
-- Sem dados clínicos — apenas infraestrutura de entrega
```

### Novos endpoints

| Endpoint | Auth | Descrição |
|---|---|---|
| `POST /auth/device-token` | JWT | Registra/atualiza token do dispositivo |
| `DELETE /auth/device-token` | JWT | Remove token no logout — body `{ token }` identifica qual dispositivo |

### Eventos que disparam push

| Evento | Título | Corpo | Deep link |
|---|---|---|---|
| `exam:done` | "Exame disponível" | "Exame de [Paciente] pronto para análise" | `/doctor/patients/:id` aba Análises |
| Mensagem chat inter-clínica | "Nova mensagem" | "[Clínica X] enviou uma mensagem" | `/chat` conversa específica |
| Alerta clínico crítico/high | "Alerta clínico" | "Alerta crítico em [Paciente]" | `/doctor/patients/:id` |
| Comunicado master | "GenomaFlow" | Primeiros 80 chars do comunicado | `/chat` conversa master |
| Lembrete de consulta | "Consulta em 1 hora" | "[Paciente] — [hora]" | `/agenda` |

### Deep link

O payload da notificação inclui `data: { route: '/doctor/patients/uuid' }`. Ao tocar, `PushNotifications.addListener('pushNotificationActionPerformed')` navega via Angular Router para a rota correta.

### Serviço backend

`apps/api/src/services/push.js` — wrapper sobre `firebase-admin`:
- `sendToUser(userId, { title, body, data })` — busca todos os tokens do user, envia em paralelo, remove tokens expirados (FCM retorna `registration-not-registered`)
- `sendToTenant(tenantId, ...)` — envia para todos os usuários do tenant
- Falha de push não derruba a request principal (try/catch, best-effort)

---

## 3. Auth & Armazenamento Seguro

### Armazenamento do JWT

| Ambiente | Armazenamento |
|---|---|
| Browser (web) | `localStorage` — sem alteração |
| App nativo | `@capacitor/preferences` → Keychain (iOS) / EncryptedSharedPreferences (Android) |

O `AuthService` detecta `Capacitor.isNativePlatform()` e usa a camada correta. A lógica de negócio (guards, interceptors, refresh) não muda.

### Login biométrico (M3)

**Primeiro acesso:**
1. Login normal com email + senha
2. App pergunta: *"Ativar Face ID / Touch ID para próximos acessos?"*
3. Se aceitar: credenciais armazenadas no Keychain protegidas pela biometria nativa

**Acessos subsequentes:**
1. App abre → tela de biometria (sem campos de email/senha)
2. Autenticação biométrica bem-sucedida → JWT renovado via `POST /auth/refresh` (novo endpoint)
3. Falha na biometria → fallback para email/senha

**Sessão:** JWT atual tem TTL de 90 dias — adequado para mobile. Refresh token completo é escopo pós-M1.

---

## 4. Native UX

Ajustes que fazem o app sentir nativo, não um site embutido. Todos são aditivos — nenhum afeta o build web.

### Safe area

`app.component.ts` adiciona a classe `capacitor-native` ao `document.body` quando `Capacitor.isNativePlatform()` for `true` (executado no `ngOnInit`). Isso permite escopo CSS seguro:

```css
/* styles.scss */
body.capacitor-native {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
```

As variáveis `env(safe-area-inset-*)` são definidas pelo SO nativo e são zero no browser — a classe é uma camada extra de segurança. Evita conteúdo sob notch (iPhone), Dynamic Island, ou barra de câmera (Android).

### Back button Android

```typescript
// app.component.ts — só registra em plataforma nativa
App.addListener('backButton', ({ canGoBack }) => {
  if (!canGoBack || this.router.url === '/doctor/patients') {
    App.exitApp();
  } else {
    this.location.back();
  }
});
```

Sem isso, o hardware back button fecha o app em qualquer tela.

### Câmera nativa

Upload de imagem de exame usa `<input type="file">` no web — continua funcionando. No mobile, o `ImageUploadService` detecta plataforma nativa e usa `@capacitor/camera` para abrir câmera/galeria com UI nativa (melhor UX + câmera traseira com resolução completa).

### Status bar e splash

- Status bar: cor `#0b1326` (fundo escuro do app), texto claro
- Splash screen: logo GenomaFlow em `#0b1326`, auto-hide após Angular inicializar

---

## 5. CI/CD Pipeline Mobile

### Princípio

`deploy.yml` (web + API) não é alterado. Mobile tem workflow separado `deploy-mobile.yml`, disparado exclusivamente por tags de versão.

### Trigger

```yaml
on:
  push:
    tags: ['v*.*.*']   # v1.0.0, v1.2.3, etc.
                        # nunca dispara em push normal para main
```

### Jobs paralelos

```yaml
jobs:
  build-android:
    runs-on: ubuntu-latest
    steps:
      - Setup Java 17 + Node 20
      - ng build --configuration=mobile
      - npx cap sync android
      - Gradle: ./gradlew bundleRelease
      - Assina AAB com Android Keystore
      - Fastlane: upload para Play Store (track: internal)

  build-ios:
    runs-on: macos-latest        # Xcode disponível apenas em macOS
    steps:
      - Setup Node 20 + Ruby (Fastlane)
      - ng build --configuration=mobile
      - npx cap sync ios
      - Fastlane: build + archive + export IPA assinado
      - Fastlane: upload para TestFlight
```

### Secrets necessários (GitHub Secrets)

| Secret | Uso |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Assina APK/AAB |
| `ANDROID_KEYSTORE_PASSWORD` | Senha do keystore |
| `GOOGLE_PLAY_JSON_KEY` | Credencial API Google Play |
| `APPLE_CERT_BASE64` | Certificado de distribuição iOS |
| `APPLE_PROVISIONING_PROFILE` | Perfil de provisionamento |
| `APP_STORE_CONNECT_API_KEY` | Credencial API App Store Connect |
| `FIREBASE_SERVICE_ACCOUNT` | Push notifications (já vai para AWS Secrets Manager também) |

### Promoção de versão

CI entrega para track interno (Play) e TestFlight (iOS). Promoção para produção pública é sempre decisão humana via console das lojas.

---

## 6. Fases de Entrega

| Fase | O que entrega | Pré-requisito |
|---|---|---|
| **M1 — Foundation** | Capacitor setup, `environment.mobile.ts`, `angular.json` config mobile, ícone, splash, safe area, back button Android, build manual funcionando, TestFlight + Play internal | Conta Google Play ($25) + Apple Developer ($99/ano) |
| **M2 — Push Notifications** | `device_tokens` migration, `POST/DELETE /auth/device-token`, `services/push.js`, integração nos 5 eventos, deep links, `deploy-mobile.yml` básico | Firebase project criado |
| **M3 — Native UX** | Biometria, câmera nativa, status bar, `POST /auth/refresh` | M1 + M2 concluídos |
| **M4 — App Store** | Fastlane completo, signing automatizado, CI/CD por tag, publicação nas lojas | Certificados Apple + Google Play API key |

**Estimativa total:** 3–4 semanas para app completo nas lojas.

---

## 7. O que NÃO está no escopo

- Modo offline (dados médicos devem ser sempre em tempo real)
- Versão separada do design mobile (reaproveitamos o Angular responsivo)
- Live Updates / Ionic AppFlow (avaliar pós-lançamento se atualização sem store for necessária)
- Suporte a tablets (iPad / Android tablet) — escopo futuro
- React Native ou Flutter — descartados pela análise de abordagens

---

## 8. Contas e Credenciais a Criar

Antes de iniciar M1, o usuário precisa criar:

1. **Google Play Developer Account** — [play.google.com/console](https://play.google.com/console) — $25 taxa única
2. **Apple Developer Program** — [developer.apple.com](https://developer.apple.com) — $99/ano
3. **Firebase Project** — console.firebase.google.com — gratuito (volumes clínicos dentro do free tier)
