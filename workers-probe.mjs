import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,openSync,closeSync} from 'node:fs';
const require=createRequire(import.meta.url);
const turbo=resolve(dirname(require.resolve('turbo/package.json')),'bin/turbo');
const baseEnv={...process.env};delete baseEnv.VITEST_MAX_WORKERS;
mkdirSync('perf',{recursive:true});
const results=[];
for(const [i,variant] of ['A','B','B','A'].entries()){
 const env=variant==='A'?baseEnv:{...baseEnv,VITEST_MAX_WORKERS:'2'};
 const diagnostic=spawnSync(process.execPath,['worker-diagnostic.mjs'],{env,encoding:'utf8'});
 writeFileSync(`perf/config-${i+1}-${variant}.log`,diagnostic.stdout+diagnostic.stderr);
 if(diagnostic.status!==0)throw new Error('Config verification failed');
 const fd=openSync(`perf/sample-${i+1}-${variant}.log`,'w');
 const args=[turbo,'run','test','--filter=bb-plugin-provider-*','--filter=bb-plugin-tasks','--filter=bb-plugin-connect','--filter=bb-plugin-thread-list','--only','--force','--concurrency=2','--output-logs=new-only','--summarize'];
 console.log(JSON.stringify({variant,node:process.execPath,args,maxWorkers:env.VITEST_MAX_WORKERS??null}));
 const start=performance.now();let child;
 try{child=spawnSync(process.execPath,args,{env,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 results.push({variant,status:child.status,error:child.error?.message,seconds:(performance.now()-start)/1000});
 writeFileSync('perf/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
}
if(results.some(x=>x.status!==0))process.exitCode=1;
