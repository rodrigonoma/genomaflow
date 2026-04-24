# GenomaFlow Memory Index

- [Project Context](project_context.md) — Stack, arquitetura, estado atual completo (atualizado 2026-04-23)
- [User Preferences](user_preferences.md) — Language, decision style, collaboration preferences
- [Docker DB Source of Truth](project_docker_source_of_truth.md) — Docker PostgreSQL (db:5432) is the only authoritative DB; never use localhost:5432
- [Dev Workflow Rules](feedback_dev_workflow.md) — Branch, validação local, AGUARDAR aprovação explícita, depois merge — nunca mergar sem ok do usuário
- [DB Migration Discipline](feedback_db_migrations.md) — Schema changes via numbered migration files only; dev and prod must always be identical
- [URL Routing Rules](project_url_routing.md) — www + root domain → landing page; Entrar/Registrar CTAs check auth state before redirecting
- [Security Hardening Apr/2026](project_security_hardening.md) — RLS completo (032-034) + auditoria 2026-04-23 (defense in depth: tenant_id explícito em toda query, ACL master-only, UX tenant chip)
- [ECS/S3/Deploy — lições críticas](feedback_ecs_s3_deploy.md) — ECS isolado, CACHEBUST nos Dockerfiles, task definition deve ser atualizada (não só force-new-deployment), verificar imagem real antes de debugar
- [Regras de edição de código](feedback_code_editing_rules.md) — Write proibido, stash proibido, vibe coding proibido, sem afirmações sem verificar, signals reativos no Angular (computed só reage a signals lidos), verificar stash no início de sessão
- [Personas seniores obrigatórias](feedback_senior_personas.md) — Engenheiro, Arquiteto, PO, Design/UX, Eng. Dados e DBA seniores em todo raciocínio técnico
- [Compatibilidade multi-módulo](feedback_multi_module.md) — Todo ajuste/bug/feature deve funcionar para human e veterinary; dúvida → questionar; nunca causar regressão
- [Pipeline de Imagens Médicas](project_imaging_pipeline.md) — DICOM/JPG/PNG, Vision classifier, agentes por modalidade, bounding boxes, erros já corrigidos
- [Histórico de stashes recuperados](project_stash_recovery_history.md) — Registro de stashes WIP, o que foi recuperado, o que não deve ser aplicado
- [WebSocket em produção](feedback_websocket_prod.md) — WS URL DEVE incluir API_PREFIX em prod (ALB só roteia /api/*); emitir via Redis pub/sub, nunca notifyTenant direto — chat tem exemplo real de bug de 2026-04-24
- [Angular prod build — fileReplacements](feedback_angular_prod_build.md) — angular.json SEM fileReplacements faz environment.production=false em prod; sintoma inclui WS quebrado e flags de debug vazadas; auditar bundle minificado (incidente 2026-04-24)
- [AuthService — hidratar profile no F5](feedback_auth_profile_hydration.md) — persistir profile em localStorage pra evitar flicker/sumiço do chip do tenant no F5 (incidente 2026-04-24)
