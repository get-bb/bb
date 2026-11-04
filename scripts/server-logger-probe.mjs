import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availableParallelism } from 'node:os';

const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, 'server-logger-results');
mkdirSync(output, { recursive: true });
const revisions = { A: 'b77a9c9c47ea0198305fc4c4b0c03f3a72daf0d0', B: 'f331dd1527eff096c710c017be798fe30b971e7c' };
const results = [];
for (const [index, variant] of [...'ABBA'].entries()) {
  const sha = revisions[variant];
  const checkout = spawnSync('git', ['checkout', '--detach', sha], { stdio: 'inherit' });
  if (checkout.status !== 0) process.exit(checkout.status || 1);
  rmSync(join(root, 'apps/server/node_modules/.vite/vitest'), { recursive: true, force: true });
  const log = join(output, `${index + 1}-${variant}.log`);
  const fd = openSync(log, 'w');
  const start = performance.now();
  const run = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--reporter=default', '--reporter=json', `--outputFile.json=${join(output, `${index + 1}-${variant}.json`)}`], { cwd: join(root, 'apps/server'), env: { ...process.env, VITEST_MAX_WORKERS: '' }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const elapsedSeconds = (performance.now() - start) / 1000;
  const result = { index: index + 1, variant, sha, exitCode: run.status, elapsedSeconds, shard: process.env.BB_CI_TEST_SHARD, cpus: availableParallelism(), defaultWorkers: Math.max(availableParallelism()-1, 1) };
  results.push(result);
  console.log(JSON.stringify(result));
  console.log(readFileSync(log, 'utf8').split('\n').slice(-20).join('\n'));
  writeFileSync(join(output, 'summary.json'), JSON.stringify(results, null, 2));
}
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
