import { createVitest } from 'vitest/node';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
const root = process.cwd();
const file = 'apps/server/test/services/plugins/plugin-native-server-loading.test.ts';
const baseline = execFileSync('git', ['show', 'a67ada177269182df1a96df16fbd0775d0f5c835:' + file]);
const candidate = readFileSync(file);
const appRoot = resolve('apps/server');
const require = createRequire(import.meta.url);
const cli = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
mkdirSync('perf', { recursive: true });
const ctx = await createVitest('test', {root: appRoot, config: resolve(appRoot, 'vitest.config.ts'), watch: false});
let shard;
try {
  const specs = await ctx.globTestSpecifications();
  for(let index = 1; index <= 3; index++) {
    ctx.config.shard = {index, count: 3};
    const files = await new ctx.config.sequence.sequencer(ctx).shard(specs);
    if(files.some(spec => spec.moduleId.replaceAll('\\','/').endsWith('/plugin-native-server-loading.test.ts'))) {
      shard = `${index}/3`;
      writeFileSync('perf/selected-files.json',JSON.stringify(files.map(x=>x.moduleId).sort(),null,2));
    }
  }
} finally { await ctx.close(); }
if(!shard) throw new Error('Missing affected shard');
console.log('Affected shard: ' + shard);
const results=[];
try {
  for(const [index,variant] of ['A','B','B','A'].entries()) {
    writeFileSync(file,variant === 'A' ? baseline : candidate);
    const output = openSync(`perf/sample-${index+1}-${variant}.log`,'w');
    const start = performance.now();
    const args=[cli,'run','--config','vitest.config.ts'];
    console.log(JSON.stringify({variant,node:process.execPath,args,shard}));
    let child;
    try { child = spawnSync(process.execPath,args,{cwd:appRoot, env:{...process.env,BB_CI_TEST_SHARD:shard},stdio:['ignore',output,output]}); }
    finally {closeSync(output);}
    results.push({variant,seconds:(performance.now()-start)/1000,status:child.status,error:child.error?.message});
    writeFileSync('perf/results.json',JSON.stringify(results,null,2));
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {writeFileSync(file,candidate);}
if(results.some(x=>x.status !== 0)) process.exitCode=1;
