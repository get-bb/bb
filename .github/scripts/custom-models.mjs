import {spawnSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const output=join(process.env.RUNNER_TEMP,'custom-models');mkdirSync(output,{recursive:true});
const file='tests/integration/fake/smoke/custom-models.test.ts';const before=readFileSync(file,'utf8');
const after=before.replaceAll('"claude-code"','"fake"').replaceAll('claude-example-preview[1m]','fake-example-preview[1m]');
const results=[];
function run(name,focused) {
 const report=join(output,name+'.json');const fd=openSync(join(output,name+'.log'),'w');const start=Date.now();
 const result=spawnSync('pnpm',['exec','turbo','run','test','--filter=@bb/integration-tests','--force','--',...(focused?['fake/smoke/custom-models.test.ts']:[]),'--reporter=json','--outputFile='+report],{shell:true,stdio:['ignore',fd,fd],env:{...process.env,VITEST_MAX_WORKERS:'4'},timeout:600000});closeSync(fd);
 const data=existsSync(report)?JSON.parse(readFileSync(report,'utf8')):null;const tests=data?.testResults.flatMap(s=>s.assertionResults)??[];
 const row={name,status:result.status,durationMs:Date.now()-start,error:result.error?.message,passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed'),target:tests.filter(t=>t.fullName.includes('offers config-registered custom models')).map(t=>({name:t.fullName,status:t.status,duration:t.duration}))};
 results.push(row);writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));console.log(name,row.status,row.passed,row.target);
 if(row.target.length!==1)throw new Error('Target was not executed exactly once');
}
for(const [i,variant] of ['before','after','after','before'].entries()) {
 writeFileSync(file,variant==='before'?before:after);
 run(i+'-'+variant+'-focused',true);
 run(i+'-'+variant+'-full',false);
}
