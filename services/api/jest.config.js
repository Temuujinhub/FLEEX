// Jest config for the Fleex API. Runs both unit specs colocated under src/
// and e2e specs under test/. ts-jest compiles with the project tsconfig so
// NestJS decorator metadata (emitDecoratorMetadata) is preserved for DI.
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // e2e bootstraps a Nest app per suite; give it headroom over the 5s default.
  testTimeout: 30000,
  clearMocks: true,
};
