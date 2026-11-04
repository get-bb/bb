import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const file='packages/bb-app/scripts/smoke-tarball.mjs';
const candidate=await readFile(file,'utf8'), baseline=execFileSync('git',['show','7e83fb7ef07838783af6958365997aa52fb51b82:'+file],{encoding:'utf8'});
const dir=join(process.env.RUNNER_TEMP,'mac-smoke-results');await mkdir(dir,{recursive:true});const results=[];
try{for(const [i,label] of process.env.PROBE_ORDER.split(',').entries()){
await writeFile(file,label==='baseline'?baseline:candidate);const started=performance.now();
const child=spawn(process.execPath,[file],{stdio:['ignore','pipe','pipe'],env:{...process.env,npm_config_cache:join(process.env.RUNNER_TEMP,'smoke-npm-'+i)}});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b;process.stdout.write(b)});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
await writeFile(join(dir,i+'-'+label+'.log'),log);results.push({i,label,seconds:(performance.now()-started)/1000,code});await writeFile(join(dir,'summary.json'),JSON.stringify(results,null,2));console.log('MEASURE',JSON.stringify(results.at(-1)));assert.equal(code,0);
}}finally{await writeFile(file,candidate);}
