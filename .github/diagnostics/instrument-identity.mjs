import { readFileSync, writeFileSync } from 'node:fs';
const file='packages/process-utils/src/process-info.ts';
let text=readFileSync(file,'utf8');
text=`import { appendFileSync } from 'node:fs';\n${text}`;
text=text.replace('async function readWindowsProcess(pid: number) {','async function readWindowsProcess(pid: number) {\nconst started=Date.now();');
text=text.replace('    const { stdout } = await pending;','    const { stdout } = await pending;\nappendFileSync("identity-observations.jsonl", JSON.stringify({pid,ms:Date.now()-started,stdout})+"\\n");');
text=text.replace('    return { command: value.command, startedAt: value.startedAt };\n  } catch {','    return { command: value.command, startedAt: value.startedAt };\n  } catch (error) {\nappendFileSync("identity-observations.jsonl", JSON.stringify({pid,ms:Date.now()-started,error:error instanceof Error ? {...error,message:error.message} : error})+"\\n");');
if(process.argv[2]==='wmi') {
  const start=text.indexOf('          `Get-CimInstance');
  const end=text.indexOf('`,',start)+2;
  text=text.slice(0,start)+'          `$process = [System.Management.ManagementObject]::new(\'Win32_Process.Handle="${pid}"\'); try { $process.Get(); @{ command = $process.CommandLine; startedAt = ([DateTimeOffset][System.Management.ManagementDateTimeConverter]::ToDateTime($process.CreationDate)).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress } finally { $process.Dispose() }`,'+text.slice(end);
}
writeFileSync(file,text);
