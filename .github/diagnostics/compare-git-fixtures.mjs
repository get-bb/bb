import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = 'd0bf4528508b46beafe5f7ef526e506cde5e0313';
const candidate = process.env.CANDIDATE;
const file = process.env.TEST_FILE;
const pkg = process.env.PACKAGE_NAME;
const dir = process.env.PACKAGE_DIR;
const output = resolve('fixture-timings');
mkdirSync(output, { recursive: true });
const results = [];
for (const [index, mode] of ['baseline', 'candidate', 'candidate', 'baseline', 'baseline', 'candidate'].entries()) {
  writeFileSync(file, execFileSync('git', ['show', `${mode === 'baseline' ? base : candidate}:${file}`]));
  const report = resolve(output, `${index}-${mode}.json`);
  const start = performance.now();
  const result = spawnSync('bash', ['-lc', `pnpm --filter '${pkg}' exec vitest run --config vitest.config.ts --reporter=default --reporter=json --outputFile='${report.replaceAll('\\', '/')}'`], { stdio: 'inherit', env: process.env });
  const elapsed = (performance.now() - start) / 1000;
  if (result.status !== 0) process.exit(result.status || 1);
  const data = JSON.parse(readFileSync(report, 'utf8'));
  const target = data.testResults.find(r => r.name.replaceAll('\\', '/').endsWith(file.slice(dir.length + 1)));
  const row = { index, mode, package: pkg, elapsed, tests: data.numTotalTests, passed: data.numPassedTests, fileSeconds: target ? (target.endTime - target.startTime) / 1000 : null };
  results.push(row);
  console.log('BENCHMARK', JSON.stringify(row));
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(results, null, 2));
}
