process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/genomaflow_test';
process.env.DATABASE_URL_TEST = 'postgres://postgres:postgres@localhost:5432/genomaflow_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'genomaflow-dev-secret-key';
process.env.UPLOADS_DIR = '/tmp/uploads';

module.exports = {
  testEnvironment: 'node',
  // Run tests sequentially to avoid shared DB conflicts
  maxWorkers: 1,
};
