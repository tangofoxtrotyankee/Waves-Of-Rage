/**
 * Runs every suite in turn, inheriting their output, and exits non-zero if
 * any failed, so one red suite never hides the others. `npm test`.
 */
import { spawnSync } from 'node:child_process';

const suites = ['tests/api.mjs', 'tests/e2e.mjs', 'tests/boardmasters-e2e.mjs'];
const results = suites.map((file) => {
  console.log(`\n=== ${file} ===`);
  const { status } = spawnSync(process.execPath, [file], { stdio: 'inherit', env: process.env });
  return { file, ok: status === 0 };
});
console.log('\n' + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.file}`).join('\n'));
process.exit(results.every((r) => r.ok) ? 0 : 1);
