import { copyFileSync, mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const output = join(process.env.RUNNER_TEMP, 'ci-nov2-pr-fixture');
mkdirSync(output, { recursive: true });
const rows = [];
for (const [index, variant] of ['warmup', 'after', 'before', 'before', 'after'].entries()) {
  const source = variant === 'after' ? '.bb-ci-pr-fixture/after.ts' : '.bb-ci-pr-fixture/before.ts';
  copyFileSync(source, 'plugins/github-pr-status/host.test.ts');
  const fd = openSync(join(output, `${index}-${variant}.log`), 'w');
  const started = performance.now();
  const result = spawnSync('pnpm exec vitest run --config vitest.config.ts --silent=false', { cwd: resolve('plugins/github-pr-status'), shell: true, stdio: ['ignore', fd, fd], env: process.env });
  closeSync(fd);
  const row = { index, variant, seconds: (performance.now() - started) / 1000, exitCode: result.status, error: result.error?.message };
  rows.push(row);
  writeFileSync(join(output, 'results.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
}
process.exitCode = rows.some(row => row.exitCode !== 0) ? 1 : 0;
