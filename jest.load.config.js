/** @type {import('jest').Config} */
const integration = require('./jest.config.js').projects.find(project => project.displayName === 'integration');

// Reuse the real PostgreSQL setup and source transforms; only the benchmark is selected.
module.exports = {
  ...integration,
  rootDir: __dirname,
  displayName: 'load',
  testMatch: ['<rootDir>/packages/stats/tests/load.int.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
