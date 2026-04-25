module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Padrão de descoberta — mantém compatibilidade com layout existente
  testMatch: ['<rootDir>/tests/**/*.test.js'],
};
