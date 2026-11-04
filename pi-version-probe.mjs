import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
const require = createRequire(import.meta.url);
const turbo = resolve(dirname(require.resolve('turbo/package.json')), 'bin/turbo');
mkdirSync('perf', { recursive: true });
const results = [];
for (let i=1;i<=1;i++) {
 const fd = openSync(`perf/full-${i}.log`, 'w');
 const start = performance.now();
 const child = spawnSync(process.execPath, [turbo,'run','test','--filter=bb-plugin-provider-*','--filter=bb-plugin-tasks','--filter=bb-plugin-connect','--filter=bb-plugin-thread-list','--only','--force','--concurrency=2','--output-logs=new-only'], { stdio: ['ignore',fd,fd] });
 closeSync(fd);results.push({trial:i,status:child.status,seconds:(performance.now()-start)/1000});
 writeFileSync('perf/results.json',JSON.stringify(results,null,2)); console.log(results.at(-1));
}
if(results.some(x=>x.status!==0))process.exitCode=1;
