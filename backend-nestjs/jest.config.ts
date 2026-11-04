import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    // Custom wrapper around ts-jest: compiles the ESM-only @nestjs packages to
    // CommonJS AND fixes the `import.meta.url` token that survives ts-jest's
    // CJS transpilation (a SyntaxError in Jest's CommonJS wrapper, which Jest
    // misreports as "Must use import to load ES Module" on Node < 24.9).
    // See test/transform/ts-cjs-transform.js for the full explanation.
    '^.+\\.(t|j)s$': '<rootDir>/test/transform/ts-cjs-transform.js',
  },
  // Keep transforming ESM-only @nestjs packages while leaving all other
  // node_modules untouched.
  transformIgnorePatterns: ['node_modules/(?!(.pnpm)?@nestjs/)'],
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    'libs/**/*.(t|j)s',
    'apps/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  // NodeNext source imports name their emitted .js files; Jest runs the .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};

export default config;
