import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const execute=promisify(execFile);
const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000);process.stdout.write("ready")','bb-identity-Ω-special'],{stdio:['ignore','pipe','pipe']});
const closed=once(child,'close');await once(child.stdout,'data');
const scripts={cim:pid=>`Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,wmi:pid=>`$process = [System.Management.ManagementObject]::new('Win32_Process.Handle="${pid}"'); try { $process.Get(); @{ command = $process.CommandLine; startedAt = ([DateTimeOffset][System.Management.ManagementDateTimeConverter]::ToDateTime($process.CreationDate)).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress } finally { $process.Dispose() }`};
const rows=[];
async function read(mode,pid){const start=performance.now();let value=null,error=null;try{const pending=execute(ps,['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${scripts[mode](pid)}`],{encoding:'utf8',timeout:30000,maxBuffer:1048576});pending.child.stdin.end(); const {stdout}=await pending;value=JSON.parse(stdout);}catch(e){error={code:e.code,killed:e.killed,signal:e.signal,stderr:e.stderr};} const row={mode,pid,ms:performance.now()-start,value,error};rows.push(row);console.log(JSON.stringify(row));return row;}
try{for(const mode of ['cim']){const pair=await Promise.all([read(mode,child.pid),read(mode,child.pid)]);for(const row of pair){if(row.error)continue;if(!row.value.command.includes('bb-identity-Ω-special')||Math.abs(Date.now()-row.value.startedAt)>300000)throw new Error('Identity mismatch');}} child.kill('SIGKILL');await closed;await read('cim',child.pid);await read('wmi',child.pid);}finally{child.kill('SIGKILL');await closed;writeFileSync('process-identity.json',JSON.stringify(rows,null,2));}
