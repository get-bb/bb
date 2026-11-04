import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import afterPack from '../apps/desktop/scripts/prepare-native-modules.cjs';
const exec=promisify(execFile);
const root=resolve('apps/desktop/release/win-unpacked');
const modules=join(root,'resources/app.asar.unpacked/node_modules');
const script=resolve('apps/desktop/scripts/nov4-before-smoke.mjs');
const current=await readFile('apps/desktop/scripts/smoke-packaged-app.mjs','utf8');
const old=current.includes('await smokePackagedNpm(appBinary);')?current:current.replace('const scriptDirectory', 'import { smokePackagedNpm } from "./smoke-packaged-npm.mjs";\nconst scriptDirectory').replace('  const smokeRoot =','  await smokePackagedNpm(appBinary);\n  const smokeRoot =');
await writeFile(script,old);
const context={appOutDir:root,electronPlatformName:'win32',arch:1,packager:{appInfo:{productFilename:'bb'}}};
const oldFails=async(pattern)=>{
 let failure;
 try{await exec(process.execPath,[script],{timeout:90000,maxBuffer:2*1024*1024});}catch(error){failure=error;}
 assert.ok(failure,'old smoke unexpectedly passed');assert.match(String(failure.stderr)+String(failure.stdout),pattern);
};
const manifest=join(modules,'npm/package.json');
await rename(manifest,manifest+'.parent-probe');
try{
 await oldFails(/Cannot find module|Dependency escaped artifact/);
 await assert.rejects(afterPack(context),/Cannot find module|Dependency escaped artifact/);
 console.log('INDEPENDENT PROOF: old smoke and retained afterPack reject missing npm manifest');
}finally{await rename(manifest+'.parent-probe',manifest);}
const cli=join(modules,'npm/bin/npm-cli.js');const original=await readFile(cli);
const marker=join(modules,'nov4-parent-mutation');
await writeFile(cli,original.toString().replace('\n','\nrequire("node:fs").writeFileSync('+JSON.stringify(marker)+',"corrupted");\n'));
try{
 await oldFails(/Plugin dependency install\/update modified packaged resources/);
 await rm(marker,{force:true});
 await assert.rejects(afterPack(context),/Plugin dependency install\/update modified packaged resources/);
 console.log('INDEPENDENT PROOF: old smoke and retained afterPack reject npm modifying packaged resources');
}finally{await writeFile(cli,original);await rm(marker,{force:true});await rm(script,{force:true});}
assert.deepEqual(await readFile(cli),original);
