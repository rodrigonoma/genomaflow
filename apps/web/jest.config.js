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
  // Plugins Capacitor são ESM nativo e não rodam em jsdom — mockar globalmente.
  moduleNameMapper: {
    '^@capacitor/core$': '<rootDir>/src/__mocks__/capacitor-core.js',
    '^@capacitor/preferences$': '<rootDir>/src/__mocks__/capacitor-preferences.js',
    '^@capgo/capacitor-native-biometric$': '<rootDir>/src/__mocks__/capacitor-native-biometric.js',
  },
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  testMatch: ['**/*.spec.ts'],
  globals: {
    ngJest: {
      tsconfig: '<rootDir>/tsconfig.spec.json'
    }
  }
};
