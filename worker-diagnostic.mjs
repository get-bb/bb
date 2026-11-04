import {createVitest} from 'vitest/node';
import {availableParallelism} from 'node:os';
import {resolve} from 'node:path';
const cpus=availableParallelism();
const rows=[];
for(const dir of ['provider-acp','provider-claude-code','provider-codex','provider-pi','provider-retry','tasks','connect','thread-list']){
const root=resolve('plugins',dir);
const ctx=await createVitest('test',{root,config:resolve(root,'vitest.config.ts'),watch:false});
try{rows.push({package:dir,configuredMaxWorkers:ctx.config.maxWorkers??null,effectiveMaxWorkers:ctx.config.maxWorkers??Math.max(cpus-1,1)});}finally{await ctx.close();}
}
console.log(JSON.stringify({availableParallelism:cpus,env:process.env.VITEST_MAX_WORKERS??null,defaultRule:'Math.max(availableParallelism - 1, 1)',projects:rows},null,2));
if(process.env.VITEST_MAX_WORKERS==='2'&&rows.some(x=>x.configuredMaxWorkers!==2))throw new Error('Worker cap did not resolve');
