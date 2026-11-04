import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, rmSync } from 'node:fs';
const require = createRequire(import.meta.url);
const turbo = resolve(dirname(require.resolve('turbo/package.json')), 'bin/turbo');
const files = execFileSync('git',['diff','--name-only','a67ada177269182df1a96df16fbd0775d0f5c835','ab3709610ffe1925c1c991b44dfb554e9ab633ef'],{encoding:'utf8'}).trim().split('\n');
const candidate = files.map(file=>readFileSync(file));
const baseline = files.map(file=>{const r=spawnSync('git',['show','a67ada177269182df1a96df16fbd0775d0f5c835:'+file]);return r.status===0?r.stdout:null;});
function apply(buffers){files.forEach((file,i)=>buffers[i]===null?rmSync(file,{force:true}):writeFileSync(file,buffers[i]));}
mkdirSync('perf',{recursive:true});
const results=[];
try {
 for (const [i,variant] of ['A','B','B','A'].entries()) {
  apply(variant==='A'?baseline:candidate);
  const fd=openSync(`perf/sample-${i+1}-${variant}.log`,'w');
  const args=[turbo,'run','test','--filter=bb-plugin-provider-*','--filter=bb-plugin-tasks','--filter=bb-plugin-connect','--filter=bb-plugin-thread-list','--only','--force','--concurrency=2','--output-logs=new-only','--summarize'];
  console.log(JSON.stringify({variant,node:process.execPath,args}));
  const start=performance.now();let result;
  try{result=spawnSync(process.execPath,args,{env:process.env,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
  results.push({variant,status:result.status,error:result.error?.message,seconds:(performance.now()-start)/1000});
  writeFileSync('perf/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
 }
} finally {apply(candidate);}
if(results.some(x=>x.status!==0))process.exitCode=1;
