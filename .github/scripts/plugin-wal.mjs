import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const output=join(process.env.RUNNER_TEMP,'plugin-wal');
mkdirSync(output,{recursive:true});
const owner='packages/plugin-sdk/src/testing/fake-plugin-host.ts';
const fixed=readFileSync(owner,'utf8');
const baseline=fixed.replace('        databaseHandle.pragma("journal_mode = WAL");\n','');
const test='plugins/github-pr-status/store.test.ts';
let source=readFileSync(test,'utf8');
const a=source.indexOf('  it("makes a one-shot read wait');
const b=source.indexOf('\n  });',a);
let body=source.slice(a,b).replace('    vi.useFakeTimers();','    const started = process.hrtime.bigint();\n    const mark = (stage: string) => console.error("FRESHNESS_STAGE", stage, Number(process.hrtime.bigint()-started)/1e6);\n    vi.useFakeTimers();');
for(const [line,stage] of [['    const { store, load } = setup([available(pullRequest())]);','setup'],['    await store.read("a", { viewer: true });','initial'],['    await vi.advanceTimersByTimeAsync(9_000);','advance9'],['    await store.read("a", { viewer: false });','read9'],['    await vi.advanceTimersByTimeAsync(2_000);','advance2']]) body=body.replace(line,line+'\n    mark("'+stage+'");');
body+='\n    mark("final");';
writeFileSync(test,source.slice(0,a)+body+source.slice(b));
const results=[];
function run(name,args) {
 const p=join(output,name+'.log');const fd=openSync(p,'w');const start=Date.now();
 const result=spawnSync('pnpm',args,{shell:true,stdio:['ignore',fd,fd],timeout:600000,env:{...process.env,VITEST_MAX_WORKERS:'2'}});
 closeSync(fd);const log=readFileSync(p,'utf8').replace(/\x1b\[[0-9;]*m/g,'');
 const row={name,status:result.status,durationMs:Date.now()-start,error:result.error?.message,diagnostics:log.split('\n').filter(l=>/FRESHNESS_STAGE|Tests\s|Test Files/.test(l))};
 results.push(row);writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));console.log(name,row.status,row.durationMs);
}
run('sdk-fixed',['exec','turbo','run','test','--filter=@get-bb/plugin-sdk','--force']);
for(const [i,mode] of ['delete','wal','wal','delete'].entries()) {
 writeFileSync(owner,mode==='wal'?fixed:baseline);
 run(i+'-'+mode+'-focused',['exec','turbo','run','test','--filter=bb-plugin-bb--github-pr-status','--force','--','store.test.ts','--silent=false']);
 run(i+'-'+mode+'-full',['exec','turbo','run','test','--filter=bb-plugin-*','--filter=!bb-plugin-provider-*','--filter=!bb-plugin-tasks','--filter=!bb-plugin-connect','--filter=!bb-plugin-thread-list','--force','--continue','--concurrency=2','--','--silent=false']);
}
writeFileSync(owner,fixed);
