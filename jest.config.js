/** @type {import('jest').Config} */
const common = {
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/apps', '<rootDir>/tests'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
          transform: { useDefineForClassFields: true },
        },
        module: { type: 'commonjs' },
        sourceMaps: true,
      },
    ],
  },
  // Dépendances publiées en ESM seul (Node 24 sait les `require`, pas le runtime de Jest).
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/kysely@|kysely/)'],
  // Les tests lisent les sources, pas dist (équivalent de la condition @picket/source).
  moduleNameMapper: {
    '^@picket/([^/]+)$': '<rootDir>/packages/$1/src/index.ts',
  },
  clearMocks: true,
  restoreMocks: true,
};

module.exports = {
  projects: [
    {
      ...common,
      displayName: 'unit',
      testMatch: ['**/tests/**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '\\.int\\.test\\.ts$'],
    },
    {
      ...common,
      displayName: 'integration',
      testMatch: ['**/tests/**/*.int.test.ts'],
      // Un Postgres jetable (Testcontainers) partagé par toutes les suites.
      globalSetup: '<rootDir>/packages/testing/src/global-setup.ts',
      globalTeardown: '<rootDir>/packages/testing/src/global-teardown.ts',
      testTimeout: 60_000,
    },
  ],
  collectCoverageFrom: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts', '!**/index.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
