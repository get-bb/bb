import { readFileSync, writeFileSync } from 'node:fs';
const file='packages/process-utils/src/process-info.ts';
let text=readFileSync(file,'utf8');
text=`import { appendFileSync } from 'node:fs';\n${text}`;
text=text.replace('async function readWindowsProcess(pid: number) {','async function readWindowsProcess(pid: number) {\nconst started=Date.now();');
text=text.replace('    const { stdout } = await pending;','    const { stdout } = await pending;\nappendFileSync("identity-observations.jsonl", JSON.stringify({pid,ms:Date.now()-started,stdout})+"\\n");');
text=text.replace('    return { command: value.command, startedAt: value.startedAt };\n  } catch {','    return { command: value.command, startedAt: value.startedAt };\n  } catch (error) {\nappendFileSync("identity-observations.jsonl", JSON.stringify({pid,ms:Date.now()-started,error:error instanceof Error ? {...error,message:error.message} : error})+"\\n");');
const start=text.indexOf('          `Get-CimInstance');
const end=text.indexOf('`,',start)+2;
const query='Get-CimInstance';
const json='ConvertTo-Json';
text=text.slice(0,start)+'          `[Console]::Error.WriteLine("bbps-query-start"); $process = '+query.replaceAll('\\','\\\\')+' Win32_Process -Filter \'ProcessId = ${pid}\'; [Console]::Error.WriteLine("bbps-query-done"); $process | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | '+json.replaceAll('\\','\\\\')+' -Compress }; [Console]::Error.WriteLine("bbps-json-done")`,'+text.slice(end);
text=text.replace('          "$ErrorActionPreference', '          "[Console]::Error.WriteLine(\\\"bbps-start\\\")",\n          "$ErrorActionPreference');
text=text.replace('    pending.child.stdin?.end();', `    pending.child.on("spawn", () => appendFileSync("identity-observations.jsonl", JSON.stringify({pid,event:"spawn",ms:Date.now()-started})+"\\n"));
    pending.child.stderr?.on("data", (data) => appendFileSync("identity-observations.jsonl", JSON.stringify({pid,event:"stderr",ms:Date.now()-started,data:String(data)})+"\\n"));
    pending.child.stdout?.on("data", (data) => appendFileSync("identity-observations.jsonl", JSON.stringify({pid,event:"stdout",ms:Date.now()-started,data:String(data)})+"\\n"));
    pending.child.stdin?.end();`);
if(process.argv[2]==='minimalpath') {
  const pathScript = '$env:PATH = "$env:SystemRoot\\System32;$env:SystemRoot\\System32\\Wbem;$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0"';
  text=text.replace('          "$ErrorActionPreference', `          ${JSON.stringify(pathScript)},\n          "$ErrorActionPreference`);
}
writeFileSync(file,text);
