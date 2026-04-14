
# Claude Code - FINAL (Docker + WSL Optimized)

## Premissas
- Sistema multiagente clínico (NÃO substitui médico)
- Multi-tenant com RLS obrigatório
- LGPD compliance

## Stack
- Angular
- Fastify
- PostgreSQL + pgvector
- Redis
- AWS
- Docker + WSL (Ubuntu)

## Regras CRÍTICAS
- NUNCA bypass RLS
- NUNCA diagnosticar
- SEMPRE usar specs
- SEMPRE validar tenant

## Docker Strategy
- Usar imagens alpine
- Evitar containers pesados
- Usar volumes nomeados
- Rodar limpeza frequente:
  docker system prune -f

## WSL Strategy
- Configurar .wslconfig com limites
- Compactar VHD periodicamente
- Rodar docker dentro do WSL

## Arquitetura
/chat → orchestrator → agents → compliance → response
