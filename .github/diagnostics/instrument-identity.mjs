import { readFileSync, writeFileSync } from 'node:fs';
const file='packages/process-utils/src/process-info.ts';
let text=readFileSync(file,'utf8');
text=`import { appendFileSync } from 'node:fs';\n${text}`;
text=text.replace('async function readWindowsProcess(pid: number) {','async function readWindowsProcess(pid: number) {\nconst started=Date.now();');
text=text.replace('    const { stdout } = await pending;','    const { stdout } = await pending;\nappendFileSync("identity-observations.jsonl", JSON.stringify({pid,ms:Date.now()-started,stdout})+"\\n");');
text=text.replace('    return { command: value.command, startedAt: value.startedAt };\n  } catch {','    return { command: value.command, startedAt: value.startedAt };\n  } catch (error) {\nappendFileSync("identity-observations.jsonl", JSON.stringify({pid,ms:Date.now()-started,error:error instanceof Error ? {...error,message:error.message} : error})+"\\n");');
if(process.argv[2]==='native') {
  text = `import { execFile } from "node:child_process";\nimport { promisify } from "node:util";\n${text}`;
  text = text.replace('const execFileAsync = execHostFile;', 'const execFileAsync = promisify(execFile);').replace('import { execHostFile } from \"./host-process.js\";\n', '');
}
text=text.replace('          "$ErrorActionPreference', '          "[Console]::Error.WriteLine(\\\"bbps-start\\\")",\n          "$ErrorActionPreference');
text=text.replace('    pending.child.stdin?.end();', `    pending.child.on("spawn", () => appendFileSync("identity-observations.jsonl", JSON.stringify({pid,event:"spawn",ms:Date.now()-started})+"\\n"));
    pending.child.stderr?.on("data", (data) => appendFileSync("identity-observations.jsonl", JSON.stringify({pid,event:"stderr",ms:Date.now()-started,data:String(data)})+"\\n"));
    pending.child.stdout?.on("data", (data) => appendFileSync("identity-observations.jsonl", JSON.stringify({pid,event:"stdout",ms:Date.now()-started,data:String(data)})+"\\n"));
    pending.child.stdin?.end();`);
writeFileSync(file,text);
