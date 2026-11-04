import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
const root=process.cwd();
const desktop=join(root,"apps/desktop");
const configPath=join(desktop,"electron-builder.config.json");
const candidate=await readFile(configPath,"utf8");
const baseline=execFileSync("git",["show","eb9a2bc60b533f9e731e56a5bdd15c60419f7ac7:apps/desktop/electron-builder.config.json"],{encoding:"utf8"});
const configs={baseline,candidate};
const order=process.env.PROBE_ORDER.split(",");
assert.deepEqual([...order].sort(),["baseline","candidate"]);
const evidence=join(process.env.RUNNER_TEMP,"desktop-pattern-results");
await mkdir(evidence,{recursive:true});
const requireBuilder=createRequire(createRequire(join(desktop,"package.json")).resolve("electron-builder"));
const requireAppBuilder=createRequire(requireBuilder.resolve("app-builder-lib"));
const asar=requireAppBuilder("@electron/asar");
async function run(command) {
 const started=performance.now();
 const child=spawn(process.env.ComSpec,["/d","/s","/c",command],{cwd:root,stdio:"inherit",windowsHide:true});
 const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
 assert.equal(code,0,command);
 return (performance.now()-started)/1000;
}
async function inventory(label) {
 const archive=join(desktop,"release/win-unpacked/resources/app.asar");
 const files={};let bytes=0,maps=0,mapBytes=0;
 for(const listed of asar.listPackage(archive)) {
  const name=listed.replace(/^[\\/]+/,"").replaceAll("\\","/");
  const stat=asar.statFile(archive,name);
  if(typeof stat.size!=="number")continue;
  const contents=asar.extractFile(archive,name);
  files[name]={bytes:contents.length,sha256:createHash("sha256").update(contents).digest("hex")};
  bytes+=contents.length;if(name.endsWith(".map")){maps++;mapBytes+=contents.length;}
 }
 await writeFile(join(evidence,label+"-inventory.json"),JSON.stringify(files));
 return {files,stats:{files:Object.keys(files).length,bytes,maps,mapBytes}};
}
const results={};
try {
 for(const label of order) {
  await writeFile(configPath,configs[label]);
  console.log("PROBE warm prerequisites",label);
  await run("pnpm exec turbo run build --filter=@bb/desktop --cache-dir=.turbo/cache --output-logs=new-only");
 }
 for(const label of order) {
  await writeFile(configPath,configs[label]);
  console.log("PROBE begin complete package",label,new Date().toISOString());
  const packageSeconds=await run("pnpm exec turbo run package:win --filter=@bb/desktop --cache-dir=.turbo/cache --output-logs=new-only --summarize");
  const guiSeconds=await run("pnpm exec turbo run smoke:packaged --filter=@bb/desktop --cache-dir=.turbo/cache --output-logs=new-only --force");
  const {files,stats}=await inventory(label);
  results[label]={files,stats,packageSeconds,guiSeconds};
  console.log("PROBE measured",JSON.stringify({label,packageSeconds,guiSeconds,...stats}));
 }
 const oldFiles=results.baseline.files,newFiles=results.candidate.files;
 const removed=Object.keys(oldFiles).filter(name=>!(name in newFiles));
 const added=Object.keys(newFiles).filter(name=>!(name in oldFiles));
 const changed=Object.keys(newFiles).filter(name=>name in oldFiles&&newFiles[name].sha256!==oldFiles[name].sha256);
 assert(removed.length>0);
 assert(removed.every(name=>name.endsWith(".map")),JSON.stringify(removed));
 assert.deepEqual(added,[]);
 assert.deepEqual(changed,[]);
 const summary={order,results:Object.fromEntries(Object.entries(results).map(([label,{files,...rest}])=>[label,rest])),removed,added,changed};
 await writeFile(join(evidence,"summary.json"),JSON.stringify(summary,null,2));
 console.log("PROBE inventory verified",JSON.stringify({removed:removed.length,removedBytes:removed.reduce((sum,name)=>sum+oldFiles[name].bytes,0),retainedByteIdentical:Object.keys(newFiles).length,added,changed}));
} finally {await writeFile(configPath,candidate);}
