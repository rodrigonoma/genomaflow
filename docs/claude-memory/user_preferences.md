---
name: User Preferences
description: How this user prefers to collaborate — language, decision style, response style
type: user
originSessionId: 6e03ff44-994d-4989-8d23-6ad314de1080
---
- Communicates in Portuguese (pt-BR) for product/domain decisions; accepts English in code and technical output.
- Prefers concise responses — doesn't need long explanations, trusts the process.
- Delegates technical decisions to Claude ("pode ser sua sugestão", "pode seguir com a sua") — present a clear recommendation with rationale rather than listing options without guidance.
- When given options, responds with short choices (letters/numbers like "a", "1", "pode seguir").
- Works in WSL + Docker Desktop on Ubuntu. Aware of memory/disk constraints — prefers Alpine images and periodic `docker system prune`.
- Comfortable with TDD workflow and subagent-driven development.
- Domain: clinical/health tech (Brazil), strong awareness of LGPD and multi-tenant SaaS requirements.
- **Senha padrão de todos os usuários de teste é `password123`** — nunca afirmar outra senha sem ter certeza. Usuários atuais: `lab@clinic.com`, `admin@clinic.com`, `doctor@clinic.com`.
- **ALWAYS execute commands directly** (docker, psql, npm, git, etc.) — never instruct the user to run commands themselves. If a step requires a shell command, run it with Bash. This applies to migrations, container restarts, builds, and anything else. The user has asked for this multiple times.
