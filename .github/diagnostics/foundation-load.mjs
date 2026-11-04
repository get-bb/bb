import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
const execute=promisify(execFile);
const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const token='bb-identity-load-control';
const target=spawn(process.execPath,['-e','setInterval(()=>{},1000);process.stdout.write("ready")',token],{stdio:['ignore','pipe','pipe']});
const targetClosed=once(target,'close');
await once(target.stdout,'data');
const startedAt=Date.now();
const rows=[];
let loadDone=false;
async function read(stage){const start=performance.now();let value=null,error=null;try{const pending=execute(ps,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter 'ProcessId = ${target.pid}' | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`],{encoding:'utf8',timeout:30000,maxBuffer:1048576});pending.child.stdin.end(); const {stdout}=await pending;value=JSON.parse(stdout);if(!value.command.includes(token)||Math.abs(value.startedAt-startedAt)>60000)throw new Error('Identity mismatch');}catch(e){error={code:e.code,killed:e.killed,signal:e.signal,message:e.message,stderr:e.stderr};}const row={stage,pid:target.pid,ms:performance.now()-start,loadDone,value,error};rows.push(row);console.log('IDENTITY_CONTROL',JSON.stringify(row));return row;}
let during;
let workload;
try {
 await read('before');
 const command='pnpm exec turbo run lint test --filter=@bb/process-utils --filter=@bb/host-workspace --filter=@bb/host-watcher --filter=@bb/agent-runtime --filter=@bb/provider-bridge-protocol --filter=@bb/provider-bridge-acp --filter=@bb/host-daemon-contract --filter=@bb/config --filter=@bb/db --cache-dir=.turbo/cache --continue --concurrency=2 --output-logs=full --log-order=stream --summarize --force';
 workload=spawn(process.env.ComSpec??'C:\\Windows\\System32\\cmd.exe',['/d','/s','/c',command],{stdio:['ignore','pipe','pipe']});
 const workloadClosed=once(workload,'close');
 const observe=(data)=>{
  process.stdout.write(data);
  if(!during&&String(data).includes(' RUN ')) during=(async()=>{for(let index=0;index<3&&!loadDone;index++){await read(`during-${index}`);if(!loadDone)await delay(2000);}})();
 };
 workload.stdout.on('data',observe);workload.stderr.on('data',observe);
 const [code,signal]=await workloadClosed;loadDone=true;
 await during;
 await read('after');
 rows.push({stage:'workload',code,signal,duringObserved:during!==undefined});
 process.exitCode=code??1;
} finally {
 if(workload&&!loadDone)workload.kill();
 target.kill('SIGKILL');await targetClosed;
 writeFileSync('identity-load.json',JSON.stringify(rows,null,2));
}
