import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const baseline = '7e83fb7ef07838783af6958365997aa52fb51b82';
const candidate = 'e880beb00c4ce8f504edc4a5d63a3a7b58bcbb0e';
const root = 'apps/app/src/components/ui/';
const paths = ['markdown-incremental-pieces.test.ts', 'markdown-incremental-pieces-test-helpers.ts', 'markdown-incremental-pathological.test.ts'];
mkdirSync('app-benchmark', { recursive: true });
const results = [];
for (const [index, variant] of ['B', 'A', 'A', 'B'].entries()) {
  for (const file of paths) {
    if (variant === 'A' && file !== paths[0]) rmSync(root + file, { force: true });
    else writeFileSync(root + file, execFileSync('git', ['show', `${variant === 'A' ? baseline : candidate}:${root + file}`]));
  }
  const label = `${process.env.BB_CI_TEST_SHARD.replace('/', '-')}-${index}-${variant}`;
  const started = performance.now();
  let status = 'success';
  let output;
  try {
    output = execFileSync('cmd.exe', ['/d', '/s', '/c', `pnpm exec turbo run test --filter=@bb/app --force --continue --concurrency=2 --output-logs=full -- --reporter=default --reporter=json --outputFile=../../app-benchmark/${label}.json`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    status = 'failure';
    output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  }
  writeFileSync(`app-benchmark/${label}.log`, output);
  results.push({ label, status, milliseconds: performance.now() - started });
  writeFileSync('app-benchmark/timings.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}
if (results.some(result => result.status !== 'success')) process.exitCode = 1;
