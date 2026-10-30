import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('diagnostic-results', {recursive:true});
const results=[];
for (const [index, variant] of ['before','after','after','before'].entries()) {
  copyFileSync(`.github/diagnostics/app-${variant}/fake-flow-layout.ts`, 'apps/app/src/test/fake-flow-layout.ts');
  copyFileSync(`.github/diagnostics/app-${variant}/thread-opening.model.test.tsx`, 'apps/app/src/views/thread-detail/thread-opening.model.test.tsx');
  for (const scope of ['focused','shard']) {
    const args = scope==='focused' ? 'src/views/thread-detail/thread-opening.model.test.tsx src/components/ui/markdown-incremental-pieces.test.ts' : '';
    const start=performance.now();
    const result=spawnSync(`pnpm --filter @bb/app exec vitest run --config vitest.config.ts ${args}`, {shell:true,env:{...process.env,VITEST_MAX_WORKERS:'4',BB_CI_TEST_SHARD:scope==='shard'?'2/4':''},encoding:'utf8',maxBuffer:64*1024*1024});
    writeFileSync(`diagnostic-results/${index}-${variant}-${scope}.log`,result.stdout+result.stderr);
    results.push({index,variant,scope,status:result.status,seconds:(performance.now()-start)/1000});
    writeFileSync('diagnostic-results/app-status.json',JSON.stringify(results,null,2));
    if(result.status!==0) process.exitCode=1;
  }
}
