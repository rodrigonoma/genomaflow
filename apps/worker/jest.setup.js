// Env vars dummy pra permitir que módulos com `new OpenAI(...)` ou
// `new Anthropic(...)` instanciados em top-level carreguem em testes.
// Os clientes nunca são chamados de fato — testes mockam @anthropic-ai/sdk
// e openai antes do require dos módulos sob teste.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test-dummy';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-dummy';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
