import { createVitest } from 'vitest/node';

const [mode, file] = process.argv.slice(2);
if (
  (mode !== '--full' && mode !== '--file') ||
  (mode === '--file' && !file) ||
  (mode === '--full' && file !== undefined) ||
  process.argv.length > 4
) {
  throw new Error('usage: collect-test-registrations.mjs (--full | --file <path>)');
}
const ctx = await createVitest('test', {
  root: process.cwd(),
  watch: false,
  run: true,
  reporters: [],
  ...(mode === '--full' ? { exclude: ['test/artifact-contents.test.ts'] } : {}),
});
try {
  const result = await ctx.collect(file === undefined ? [] : [file]);
  if (result.unhandledErrors.length || process.exitCode) {
    throw new Error('TEST_REGISTRATION_COLLECTION_FAILED', { cause: result.unhandledErrors });
  }
  // The CLI list JSON drops skipped tasks. Public collection exposes every registered task,
  // including skipped suites and todo cases, without running any test body.
  const cases = result.testModules.flatMap(module =>
    [...module.children.allTests()].map(test => ({
      file: module.moduleId,
      projectName: module.project.name || undefined,
      name: test.fullName,
    })),
  );
  process.stdout.write(JSON.stringify(cases));
} finally {
  await ctx.close();
}
