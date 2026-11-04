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
if(process.argv[2]==='withouttmpdir') {
  text=text.replace('        encoding: "utf8",', '        env: { ...process.env, TMPDIR: undefined },\n        encoding: "utf8",');
}
if(process.argv[2]==='minimalpath') {
  const pathScript = '$env:PATH = "$env:SystemRoot\\System32;$env:SystemRoot\\System32\\Wbem;$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0"';
  text=text.replace('          "$ErrorActionPreference', `          ${JSON.stringify(pathScript)},\n          "$ErrorActionPreference`);
}
writeFileSync(file,text);

const testFile='packages/config/test/verified-process-stop.test.ts';
let test=readFileSync(testFile,'utf8');
test='import { readFileSync, writeFileSync } from "node:fs";\nimport { readProcessIdentity } from "@bb/process-utils";\n'+test;
test=test.replace('  const args = {', `  const controller = JSON.parse(readFileSync(new URL("../../../.github/diagnostics/identity-controller.json", import.meta.url), "utf8"));
  writeFileSync(new URL("../../../.github/diagnostics/identity-test.json", import.meta.url), JSON.stringify({pid:child.pid,token,startedAt,execPath:process.execPath}));
  const controllerRead = readProcessIdentity(controller.pid);
  onTestFinished(async () => { await controllerRead; });
  const args = {`);
writeFileSync(testFile,test);
if(process.argv[2]==='localappdata') {
  const config=readFileSync('turbo.json','utf8');
  const next=config.replace('"globalPassThroughEnv": ["npm_config_store_dir", "pnpm_config_store_dir"]', '"globalPassThroughEnv": ["npm_config_store_dir", "pnpm_config_store_dir", "LOCALAPPDATA"]');
  if(next===config)throw new Error('Expected global passthrough list');
  writeFileSync('turbo.json',next);
}
if(process.argv[2]==='pscache') {
  const config=readFileSync('turbo.json','utf8');
  const next=config.replace('"globalPassThroughEnv": ["npm_config_store_dir", "pnpm_config_store_dir"]', '"globalPassThroughEnv": ["npm_config_store_dir", "pnpm_config_store_dir", "PSModuleAnalysisCachePath"]');
  if(next===config)throw new Error('Expected global passthrough list');
  writeFileSync('turbo.json',next);
}
