---
name: DB migration discipline
description: Any schema change must be a numbered migration applied to dev first, then prod via CI/CD — never diverge schemas
type: feedback
originSessionId: 6e03ff44-994d-4989-8d23-6ad314de1080
---
All schema changes (tables, columns, indexes, RLS policies, constraints) must:
1. Be written as a numbered SQL migration in `apps/api/src/db/migrations/`
2. Applied to local Docker DB first (`docker compose exec api node src/db/migrate.js`)
3. Validated in dev before approval
4. Applied to prod via CI/CD pipeline after merge (ECS migrate task)

Never alter prod schema directly. Dev and prod schemas must always be identical.

**Why:** Previous sessions added columns and roles directly to prod via migration task without the corresponding file existing in the codebase first, causing schema drift and hard-to-diagnose 500 errors (e.g., `column u.active does not exist`).

**How to apply:** If a feature requires a schema change, write the migration file first, run it locally, include it in the branch commit. Never patch prod schema manually.
