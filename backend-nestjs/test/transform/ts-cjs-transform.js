'use strict';

/**
 * Custom Jest transformer for the McZEN backend test suite.
 *
 * WHY THIS EXISTS
 * NestJS 12 ships ESM-only packages ("type": "module"). Jest 30 on Node 22
 * cannot `require()` those files natively (that needs Node 24.9+), so they
 * must be compiled to CommonJS by a transform. ts-jest can do that (with
 * allowJs + module:"commonjs"), but one construct survives transpilation
 * verbatim: `import.meta.url` (used by @nestjs/common load-package.util.js).
 * `import.meta` is a SyntaxError inside a CommonJS wrapper, which Jest then
 * misreports as "Must use import to load ES Module".
 *
 * This wrapper delegates to ts-jest with CommonJS-forcing compiler options and
 * rewrites the remaining `import.meta.url` tokens to their CommonJS
 * equivalent (`pathToFileURL(__filename).href`).
 *
 * No new dependencies: uses the already-installed ts-jest + typescript.
 */

const ts = require('typescript');
const { TsJestTransformer } = require('ts-jest');

// Same overrides as documented in jest.config.ts. ts-jest merges the inline
// object over the on-disk tsconfig.json, so conflicting disk options must be
// overridden explicitly.
const { config } = ts.readConfigFile('./tsconfig.json', ts.sys.readFile);
const compilerOptions = config?.compilerOptions ?? {};

const tsJestConfig = {
  tsconfig: {
    ...compilerOptions,
    allowJs: true,
    module: 'commonjs',
    moduleResolution: 'node10',
    ignoreDeprecations: '6.0',
    resolvePackageJsonExports: false,
  },
};

const tsJest = new TsJestTransformer(tsJestConfig);

// `import.meta.url` in CommonJS output is a SyntaxError. Replace it with the
// CommonJS equivalent. (`__filename` is provided by Jest's CJS wrapper.)
const IMPORT_META_URL = /import\.meta\.url/g;
const COMMONJS_URL = 'require("node:url").pathToFileURL(__filename).href';

// @nestjs/typeorm (ESM-only) also declares `const require = createRequire(...)`:
// a top-level identifier shadowing the parameter that Jest's CommonJS wrapper
// injects, which is a SyntaxError ("Identifier 'require' has already been
// declared"). Renaming the DECLARATION is safe: the remaining bare `require()`
// calls in the file then use the wrapper's native require, which resolves
// packages from the file's own directory exactly like createRequire would.
const SHADOWED_REQUIRE = /const require = /g;
const SHADOWED_REQUIRE_REPLACEMENT = 'const require_ = ';

function normalizeToCommonJs(result) {
  if (typeof result === 'string') {
    return result.replace(IMPORT_META_URL, COMMONJS_URL).replace(SHADOWED_REQUIRE, SHADOWED_REQUIRE_REPLACEMENT);
  }

  if (result && typeof result.code === 'string') {
    return {
      ...result,
      code: result.code.replace(IMPORT_META_URL, COMMONJS_URL).replace(SHADOWED_REQUIRE, SHADOWED_REQUIRE_REPLACEMENT),
    };
  }

  return result;
}

exports.process = function process(sourceText, sourcePath, transformOptions) {
  return normalizeToCommonJs(tsJest.process(sourceText, sourcePath, transformOptions));
};

exports.processAsync = async function processAsync(sourceText, sourcePath, transformOptions) {
  return normalizeToCommonJs(await tsJest.processAsync(sourceText, sourcePath, transformOptions));
};

exports.getCacheKey = function getCacheKey(fileContent, filePath, transformOptions) {
  return tsJest.getCacheKey(fileContent, filePath, transformOptions);
};
