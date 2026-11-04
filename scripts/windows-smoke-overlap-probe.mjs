import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const output = join(process.env.RUNNER_TEMP, 'windows-smoke-results');
mkdirSync(output, { recursive: true });
const target = join(root, 'packages/bb-app/scripts/smoke-tarball.mjs');
const sourcePath = 'packages/bb-app/scripts/smoke-tarball.mjs';
const revisions = { A: '882de6edb018a7d86edb9fe2104404bd2e69d407', B: '56deeff142' };
const sources = Object.fromEntries(Object.entries(revisions).map(([key, revision]) => [key, execFileSync('git', ['show', `${revision}:${sourcePath}`], { encoding: 'utf8' })]));
const original = readFileSync(target, 'utf8');
const seed = join(process.env.RUNNER_TEMP, 'smoke-npm-seed');
const results = [];

function processes() {
  const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine)'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(text);
}

function copyDownloads(from, to) {
  mkdirSync(to, { recursive: true });
  for (const part of ['_cacache', '_prebuilds']) {
    if (from && existsSync(join(from, part))) cpSync(join(from, part), join(to, part), { recursive: true });
  }
}

function run(label, variant, cache, injection) {
  let source = sources[variant].replace('const smokeProcessEnv = {', 'process.stdout.write(`PROBE_ROOT ${tempRoot}\\n`);\nconst smokeProcessEnv = {');
  const branch = variant === 'A' ? 'if (process.platform === "linux" || process.platform === "darwin") {' : 'if (["win32", "linux", "darwin"].includes(process.platform)) {';
  const context = `  ${branch}\n    const results = await Promise.allSettled([`;
  if (!source.includes(context)) throw new Error('Missing runtime branch');
  source = source.replace(context, `  const runtimeStartedAt = performance.now();\n${context}`);
  source = source.replace('  process.stdout.write(\n    `bb-app tarball smoke passed', '  process.stdout.write(`PROBE_RUNTIME_MS ${performance.now() - runtimeStartedAt}\\n`);\n  process.stdout.write(\n    `bb-app tarball smoke passed');
  if (injection) {
    const labelLine = injection === 'full-stack' ? 'label: "bb-app full stack",' : 'label: "bb-server",';
    const needle = `${labelLine}\n    });\n    await waitForHttp({`;
    if (!source.includes(needle)) throw new Error('Missing injection location');
    source = source.replace(needle, `${labelLine}\n    });\n    throw new Error("PROBE_EXPECTED_${injection}");\n    await waitForHttp({`);
  }
  writeFileSync(target, source);
  const before = processes();
  const startedAt = performance.now();
  const result = spawnSync(process.execPath, [target], {
    cwd: root,
    env: { ...process.env, npm_config_cache: cache },
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    timeout: 300_000,
  });
  const wallMs = performance.now() - startedAt;
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(join(output, `${label}.log`), combined);
  const after = processes();
  const tempRoot = combined.match(/^PROBE_ROOT (.+)$/m)?.[1]?.trim();
  const beforePids = new Set(before.map((item) => item.ProcessId));
  const leftovers = after.filter((item) =>
    (tempRoot && item.CommandLine?.toLowerCase().includes(tempRoot.toLowerCase())) ||
    (item.Name?.toLowerCase() === 'node.exe' && !beforePids.has(item.ProcessId) && item.ProcessId !== process.pid)
  );
  const phases = Object.fromEntries([...combined.matchAll(/^bb-app tarball smoke: (.+) ([\d.]+)s$/gm)].map((match) => [match[1], Number(match[2])]));
  const entry = { label, variant, injection, revision: revisions[variant], status: result.status, signal: result.signal, error: result.error?.message, wallMs, smokeSeconds: Number(combined.match(/bb-app tarball smoke passed in ([\d.]+)s/)?.[1]) || null, runtimeMs: Number(combined.match(/PROBE_RUNTIME_MS ([\d.]+)/)?.[1]) || null, phases, tempRoot, tempRootExists: tempRoot ? existsSync(tempRoot) : null, leftovers };
  results.push(entry);
  writeFileSync(join(output, `${label}-processes.json`), JSON.stringify({ before, after }, null, 2));
  writeFileSync(join(output, 'results.json'), JSON.stringify({ order: process.env.SMOKE_PROBE_ORDER, platform: process.platform, node: process.version, results }, null, 2));
  console.log(JSON.stringify(entry));
  if (!tempRoot || entry.tempRootExists || leftovers.length) throw new Error(`${label}: incomplete cleanup`);
  if (injection) {
    const otherPhase = injection === 'full-stack' ? 'daemon join' : 'full stack';
    if (result.status === 0 || !combined.includes(`PROBE_EXPECTED_${injection}`) || phases[otherPhase] === undefined) throw new Error(`${label}: expected rejection or independent sibling completion missing`);
  } else if (result.status !== 0 || !entry.smokeSeconds || !entry.runtimeMs) throw new Error(`${label}: smoke failed`);
}

try {
  copyDownloads(process.env.npm_config_cache, seed);
  run('warmup', 'A', seed);
  for (const [index, variant] of [...process.env.SMOKE_PROBE_ORDER].entries()) {
    const cache = join(process.env.RUNNER_TEMP, `smoke-npm-${index}`);
    copyDownloads(seed, cache);
    run(`${index + 1}-${variant}`, variant, cache);
    rmSync(cache, { recursive: true, force: true });
  }
  const injection = process.env.SMOKE_PROBE_ORDER === 'ABBA' ? 'full-stack' : 'daemon-join';
  const failureCache = join(process.env.RUNNER_TEMP, 'smoke-npm-failure');
  copyDownloads(seed, failureCache);
  run(`failure-${injection}`, 'B', failureCache, injection);
} finally {
  writeFileSync(target, original);
}
