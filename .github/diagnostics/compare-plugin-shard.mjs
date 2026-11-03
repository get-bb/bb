import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
const base = 'd0bf4528508b46beafe5f7ef526e506cde5e0313';
const changes = [
  ['e0abd4f84d2a10e851098ce3f30932ec042ea327', 'plugins/git/host/workspace-status-cache.test.ts'],
  ['a79ab713400ae5677944863c1a86690b225d5cb4', 'plugins/environment-git-worktree/host.test.ts'],
];
const filters = ['--filter=bb-plugin-*', '--filter=!bb-plugin-provider-*', '--filter=!bb-plugin-tasks', '--filter=!bb-plugin-connect', '--filter=!bb-plugin-thread-list'];
const output = resolve('shard-timings');
mkdirSync(output, { recursive: true });
const results = [];
const run = (args) => {
  const result = spawnSync('bash', ['-lc', args.map(a => `'${a.replaceAll("'", "'\\''")}'`).join(' ')], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
};
for (const [index, mode] of process.env.ORDER.split(',').entries()) {
  for (const [candidate, file] of changes) writeFileSync(file, execFileSync('git', ['show', `${mode === 'baseline' ? base : candidate}:${file}`]));
  const cache = `.turbo/shard-comparison-${index}`;
  run(['pnpm', 'exec', 'turbo', 'run', 'build', '--filter=@get-bb/plugin-sdk', `--cache-dir=${cache}`, '--output-logs=new-only', '--concurrency=2']);
  const start = performance.now();
  run(['pnpm', 'exec', 'turbo', 'run', 'test', ...filters, `--cache-dir=${cache}`, '--continue', '--output-logs=new-only', '--summarize', '--concurrency=2']);
  const row = { index, mode, seconds: (performance.now() - start) / 1000 };
  results.push(row);
  console.log('SHARD_BENCHMARK', JSON.stringify(row));
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(results, null, 2));
  cpSync('.turbo/runs', resolve(output, `${index}-${mode}-turbo`), { recursive: true });
}
