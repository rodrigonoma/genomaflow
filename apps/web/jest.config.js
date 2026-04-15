module.exports = {
  preset: 'jest-preset-angular',
  setupFilesAfterFramework: ['<rootDir>/setup-jest.ts'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      { tsconfig: '<rootDir>/tsconfig.spec.json', stringifyContentPathRegex: '\\.html$' }
    ]
  },
  moduleFileExtensions: ['ts', 'html', 'js', 'json'],
  testPathPattern: '\\.spec\\.ts$',
  globals: {
    ngJest: {
      tsconfig: '<rootDir>/tsconfig.spec.json'
    }
  }
};
