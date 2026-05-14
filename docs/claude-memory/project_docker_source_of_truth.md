---
name: Docker DB is source of truth
description: Docker PostgreSQL (db:5432) is the single source of truth for all GenomaFlow data — never use localhost:5432 as reference
type: project
originSessionId: 6e03ff44-994d-4989-8d23-6ad314de1080
---
Docker DB (`db:5432` inside Docker network) is the only authoritative database for GenomaFlow.

**Why:** The local PostgreSQL (`localhost:5432`) was used during early dev but caused split-brain issues — data indexed locally was invisible to the Docker API, leading to chatbot failures. Established 2026-04-18.

**How to apply:**
- Worker `.env` should point `DATABASE_URL` to the Docker DB (via host IP or `host.docker.internal`) in development, not `localhost:5432`
- All backfill/seed/migration scripts must run against Docker DB
- Never recommend running queries against `localhost:5432` to check production data
- RAG backfill: `docker compose exec worker node src/rag/backfill.js`
