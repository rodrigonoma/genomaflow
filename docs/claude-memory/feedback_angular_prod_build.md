---
name: Angular production build — fileReplacements obrigatório
description: angular.json DEVE ter fileReplacements no bloco production pra environment.production=true em runtime; sem isso WS/flags vazam
type: feedback
---

`apps/web/angular.json` **DEVE** ter `fileReplacements` na configuração `production` do `architect.build`:

```json
"configurations": {
  "production": {
    "fileReplacements": [
      {
        "replace": "src/environments/environment.ts",
        "with": "src/environments/environment.prod.ts"
      }
    ],
    ...
  }
}
```

Sem isso, `ng build --configuration=production` usa `environment.ts` (que tem `production: false`) ao invés de `environment.prod.ts`. Tudo que depende de `environment.production` em runtime cai no ramo "dev" silenciosamente em prod.

**Why:** incidente 2026-04-24 teve dois fixes seguidos que pareciam resolver mas não resolviam:
1. Commit `a3224d69` migrou chat pra Redis pub/sub (correto mas não era o bug principal)
2. Commit `5c979165` prepend `/api` na URL do WS (também correto mas inútil em prod)

Mesmo com os dois deploys, chat continuou quebrado. Só achamos a causa raiz auditando o bundle minificado em prod:
- `grep 'production:!' chunk-*.js` → `production:!1` (false!) em prod
- `grep 'apiUrl' chunk-*.js` → `apiUrl:"/api"` (correto), mas o ternário `environment.production ? apiUrl : ""` caía em `""` porque o flag era false

Fix definitivo: commit `7559b82e` (adicionar fileReplacements no angular.json).

Colateral: `isProd()` em `onboarding.component.ts` também retornava `false` em prod, deixando o botão "Simular pagamento" vazar em produção pra qualquer visitante. Isso foi corrigido pelo mesmo commit.

**How to apply:**
1. Ao criar projeto Angular novo ou adicionar environment file, conferir o bloco `production` no `angular.json`. O CLI do Angular 17+ às vezes omite isso.
2. Qualquer nova flag em `environment.ts` precisa ter equivalente em `environment.prod.ts` com o valor de produção correspondente. Shapes devem estar sempre sincronizados.
3. **Validação obrigatória após build de prod** — confere no bundle minificado:
   ```bash
   cd apps/web/dist/genomaflow-web/browser
   grep -oE 'production:![01]|apiUrl:"[^"]*"' chunk-*.js main-*.js
   ```
   Deve sair `production:!0` (true) e `apiUrl:"/api"`.
4. **Red flag de produção:** "o código no repo está correto mas prod não reflete". Antes de refazer deploy, auditar bundle minificado via curl no browser:
   ```bash
   curl -sk https://genomaflow.com.br/main-*.js | grep -oE 'production:![01]'
   ```
   Se `production:!1` em prod → fileReplacements faltando.

**Arquivos relevantes:**
- `apps/web/angular.json`
- `apps/web/src/environments/environment.ts`
- `apps/web/src/environments/environment.prod.ts`

**Commits de referência:**
- Fix da causa raiz: `7559b82e` (2026-04-24) — fileReplacements no angular.json
- Vítimas do bug anterior: `5c979165` (WS URL), `a3224d69` (Redis pub/sub) — ambos corretos mas inoperantes sem o fileReplacements
