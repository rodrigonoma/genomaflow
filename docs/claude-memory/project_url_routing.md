---
name: URL routing rules
description: www.genomaflow.com.br and genomaflow.com.br must serve the landing page, not the Angular app
type: project
originSessionId: 6e03ff44-994d-4989-8d23-6ad314de1080
---
www.genomaflow.com.br and genomaflow.com.br → always show the landing page.

**Production URL:** `genomaflow.com.br` — the Angular app is served from this same domain (not a subdomain like app.*). Do NOT reference `app.genomaflow.com.br`.

Landing page CTA buttons:
- "Entrar" → if already logged in: redirect to app (role-based); if not: /login
- "Registrar" → if already logged in: redirect to app; if not: /onboarding

**Why:** Users were landing on the Angular SPA login screen instead of the marketing landing page when visiting the root domain.

**How to apply:** Any infra or routing change must preserve this behavior. The Angular SPA should never be the default for www or root domain.
