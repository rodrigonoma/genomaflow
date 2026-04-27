module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json', stringifyContentPathRegex: '\\.html$' }
    ]
  },
  // marked v18+ é ESM-only; precisa ser transformado pelo jest-preset-angular
  // (default ignora node_modules).
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?(marked|@anthropic-ai|@angular)/)'
  ],
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  testMatch: ['**/*.spec.ts'],
  globals: {
    ngJest: {
      tsconfig: '<rootDir>/tsconfig.spec.json'
    }
  }
};
