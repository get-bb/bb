import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const execute=promisify(execFile);
const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const token='bb-cache-deadline-control';
const target=spawn(process.execPath,['-e','setInterval(() => {}, 1000); process.stdout.write("ready");',token],{stdio:['ignore','pipe','pipe'],windowsHide:true});
const targetClosed=once(target,'close');await once(target.stdout,'data');
const rows=[];const workers=[];
async function read(stage,cache){const start=performance.now();let value=null,error=null;try{const pending=execute(ps,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId = ${target.pid}' | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1048576,env:cache?process.env:{...process.env,PSModuleAnalysisCachePath:undefined}});pending.child.stdin.end();const {stdout}=await pending;value=JSON.parse(stdout);if(!value.command.includes(token))throw new Error('Identity mismatch');}catch(e){error={code:e.code,killed:e.killed,signal:e.signal,message:e.message,stderr:e.stderr};}const row={stage,pid:target.pid,ms:performance.now()-start,value,error};rows.push(row);console.log(JSON.stringify(row));return row;}
try{
 await read('idle-cached',true);
 await Promise.all(Array.from({length:4},async()=>{const child=spawn(process.execPath,['-e','process.stdout.write("ready"); setImmediate(() => { while (true) {} });'],{stdio:['ignore','pipe','pipe'],windowsHide:true});const closed=once(child,'close');workers.push({child,closed});await once(child.stdout,'data');}));
 await read('loaded-cached',true);
 await read('loaded-without-cache',false);
 await read('loaded-restored-cache',true);
}finally{
 for(const {child} of workers)child.kill('SIGKILL');await Promise.all(workers.map(({closed})=>closed));
 target.kill('SIGKILL');await targetClosed;
 writeFileSync('cache-load.json',JSON.stringify(rows,null,2));
}
