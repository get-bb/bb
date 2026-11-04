import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createManagedProcessStop } from "../packages/bb-app/scripts/managed-process.mjs";
const run=promisify(execFile);
const fixture=await mkdtemp(join(tmpdir(),"bb-cleanup-boundary-"));
const realTaskkill=join(process.env.SystemRoot,"System32","taskkill.exe");
const shim=join(fixture,"bin");
await mkdir(shim);
const source=join(fixture,"DelayTaskkill.cs");
await writeFile(source, `using System; using System.Diagnostics; using System.Threading;
class DelayTaskkill { static int Main(string[] args) {
 Thread.Sleep(2300);
 var info=new ProcessStartInfo(); info.FileName=Environment.GetFolderPath(Environment.SpecialFolder.System)+"\\\\taskkill.exe";
 info.Arguments=String.Join(" ",args); info.UseShellExecute=false;
 var child=Process.Start(info); child.WaitForExit(); return child.ExitCode;
} }`);
await run(join(process.env.SystemRoot,"Microsoft.NET","Framework64","v4.0.30319","csc.exe"),["/nologo","/out:"+join(shim,"taskkill.exe"),source]);
const baseline=await run("git",["show","3b93a156695f38ea15874737977fc5e1b5f90afe:packages/bb-app/scripts/managed-process.mjs"]);
const baselineFile=join(fixture,"baseline.mjs");
await writeFile(baselineFile,baseline.stdout);
const oldStop=(await import(pathToFileURL(baselineFile))).createManagedProcessStop(5000);
const originalPath=process.env.PATH;
process.env.PATH=shim+";"+originalPath;
try {
 for(const [label,stop] of [["baseline",oldStop],["fixed",createManagedProcessStop(5000)]]) {
  const cwd=join(fixture,label); await mkdir(cwd);
  const leaderPidPath=join(fixture,label+"-leader.pid");
  const descendantScript="process.stdout.write('ready\\n');setInterval(()=>{},1000);";
  const leaderScript=join(fixture,label+"-leader.cjs");
  await writeFile(leaderScript,`require('node:fs').writeFileSync(${JSON.stringify(leaderPidPath)},String(process.pid));const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:['ignore','pipe','inherit']});child.stdout.pipe(process.stdout);setInterval(()=>{},1000);`);
  const command='"'+process.execPath+'" "'+leaderScript+'"';
  const child=spawn(process.env.ComSpec,["/d","/s","/c",'"'+command+'"'],{cwd,windowsVerbatimArguments:true,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  const closed=new Promise(resolve=>child.once("close",resolve));
  let output=""; child.stderr.on("data",chunk=>output+=chunk);
  let leaderPid;
  try {
   await new Promise((resolve,reject)=>{child.once("error",reject);child.stdout.once("data",resolve);child.once("exit",()=>reject(new Error("leader exited before ready: "+output)));});
   leaderPid=Number(await readFile(leaderPidPath,"utf8"));
   const started=performance.now();
   await stop({childProcess:child,detached:false});
   const elapsed=(performance.now()-started)/1000;
   if(label==="baseline") {
    await assert.rejects(rm(cwd,{recursive:true,force:true}),{code:"EBUSY"});
    console.log("PROBE boundary baseline reproduced EBUSY after",elapsed,"seconds");
   } else {
    await rm(cwd,{recursive:true,force:true});
    console.log("PROBE boundary fixed removed cwd after",elapsed,"seconds");
   }
  } finally {
   if(leaderPid) await run(realTaskkill,["/pid",String(leaderPid),"/T","/F"]).catch(()=>{});
   await run(realTaskkill,["/pid",String(child.pid),"/T","/F"]).catch(()=>{});
   await closed;
  }
 }
} finally {process.env.PATH=originalPath;await rm(fixture,{recursive:true,force:true});}
