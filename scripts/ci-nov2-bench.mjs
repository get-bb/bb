import { copyFileSync, mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const kind = process.argv[2];
const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, `ci-nov2-${kind}`);
mkdirSync(output, { recursive: true });
const rows = [];
const run = (label, command, directory = root) => {
  const fd = openSync(join(output, `${label}.log`), 'w');
  const started = performance.now();
  const result = spawnSync(command, { cwd: directory, shell: true, stdio: ['ignore', fd, fd], env: process.env });
  closeSync(fd);
  const row = { label, seconds: (performance.now() - started) / 1000, exitCode: result.status, error: result.error?.message };
  rows.push(row);
  writeFileSync(join(output, 'results.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
};
if (kind === 'git') copyFileSync('.bb-ci-probe/pr-host.ts', 'plugins/github-pr-status/host.test.ts');
for (const [index, variant] of ['before', 'after', 'after', 'before'].entries()) {
  if (kind === 'app') {
    copyFileSync(`.bb-ci-probe/app-${variant}.tsx`, 'apps/app/src/views/thread-detail/thread-opening.model.test.tsx');
    run(`${index}-${variant}-focused`, 'pnpm exec vitest run --config vitest.config.ts src/views/thread-detail/thread-opening.model.test.tsx', resolve('apps/app'));
    run(`${index}-${variant}-shard`, 'pnpm exec vitest run --config vitest.config.ts --shard=2/4', resolve('apps/app'));
  } else {
    copyFileSync(`.bb-ci-probe/git-${variant}.ts`, 'plugins/git/host/workspace-diff.test.ts');
    run(`${index}-${variant}-focused`, 'pnpm exec vitest run --config vitest.config.ts host/workspace-diff.test.ts', resolve('plugins/git'));
    run(`${index}-${variant}-shard`, 'pnpm exec turbo run test --filter=bb-plugin-* --filter=!bb-plugin-provider-* --filter=!bb-plugin-tasks --filter=!bb-plugin-connect --filter=!bb-plugin-thread-list --force --concurrency=2 --output-logs=full');
  }
}
if (kind === 'git') {
  for (let index = 0; index < 20; index++) {
    run(`pr-status-${index}`, 'pnpm exec vitest run --config vitest.config.ts host.test.ts -t "uses the qualified upstream target for ready, draft, and merge actions" --silent=false', resolve('plugins/github-pr-status'));
  }
}
process.exitCode = rows.some(row => row.exitCode !== 0) ? 1 : 0;
