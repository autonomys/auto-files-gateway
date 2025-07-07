const { createDefaultEsmPreset } = require('ts-jest')

module.exports = {
  ...createDefaultEsmPreset(),
  testMatch: ['**/__tests__/**/*.spec.ts'],
  setupFiles: ['./__tests__/test-setup.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coveragePathIgnorePatterns: [
    './__tests__/utils/',
    './node_modules/',
    './migrations/',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
}
