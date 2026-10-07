// Hooks use Jest's global timeout; a per-project testTimeout is not applied by
// jest-circus. PostgreSQL/container lifecycle work needs the intended 60 seconds.
jest.setTimeout(60_000);
