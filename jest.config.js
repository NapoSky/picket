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
  // ESM-only dependencies used by Kysely and Fastify's HTTP injection helper.
  // Node 24 supports `require`, but the Jest runtime needs a CommonJS transform.
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/(?:kysely|cookie)@|(?:kysely|cookie)/)'],
  // Tests read sources, not dist (equivalent to the @picket/source condition).
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
      // Benchmarks run only through stats:test:load, never in correctness suites or CI.
      testPathIgnorePatterns: ['/node_modules/', '/packages/stats/tests/load\\.int\\.test\\.ts$'],
      // One disposable PostgreSQL instance (Testcontainers) shared by all suites.
      globalSetup: '<rootDir>/packages/testing/src/global-setup.ts',
      globalTeardown: '<rootDir>/packages/testing/src/global-teardown.ts',
      setupFilesAfterEnv: ['<rootDir>/packages/testing/tests/integration-setup.ts'],
    },
  ],
  collectCoverageFrom: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts', '!**/index.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary'],
};
