// Defaults para devs rodando localmente.
// CI (integration tests) sobe Postgres service com DB 'genomaflow' e seta
// DATABASE_URL_TEST via workflow env — esses defaults NÃO devem sobrescrever.
// Padrão: respeitar env já setado.
process.env.DATABASE_URL      = process.env.DATABASE_URL      || 'postgres://postgres:postgres@localhost:5432/genomaflow_test';
process.env.DATABASE_URL_TEST = process.env.DATABASE_URL_TEST || 'postgres://postgres:postgres@localhost:5432/genomaflow_test';
process.env.REDIS_URL         = process.env.REDIS_URL         || 'redis://localhost:6379';
process.env.JWT_SECRET        = process.env.JWT_SECRET        || 'genomaflow-dev-secret-key';
process.env.UPLOADS_DIR       = process.env.UPLOADS_DIR       || '/tmp/uploads';

module.exports = {
  testEnvironment: 'node',
  // Run tests sequentially to avoid shared DB conflicts
  maxWorkers: 1,
};
