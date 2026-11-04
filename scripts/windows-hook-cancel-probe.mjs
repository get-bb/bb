import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, 'windows-hook-cancel-results');
mkdirSync(output, { recursive: true });
const results = [];
const trials = [
  ...Array.from({ length: 3 }, (_, index) => ({ label: `package-${index + 1}`, args: [] })),
  ...Array.from({ length: 20 }, (_, index) => ({ label: `focused-${index + 1}`, args: ['src/environment-lifecycle-script.test.ts', '-t', 'stops the programs Git Bash started when a Windows hook is cancelled'] })),
];
for (const trial of trials) {
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts', ...trial.args], {
    cwd: join(root, 'apps/host-daemon'),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    timeout: 180_000,
  });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(join(output, `${trial.label}.log`), text);
  const entry = { label: trial.label, status: result.status, signal: result.signal, error: result.error?.message, wallMs: performance.now() - startedAt, targetFailed: text.includes('alive-after-cancel') };
  results.push(entry);
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(entry));
  if (entry.targetFailed || result.signal) break;
}
if (results.some((entry) => entry.status !== 0)) process.exitCode = 1;
