import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(), output=join(process.env.RUNNER_TEMP,'native-types-results');
await mkdir(output,{recursive:true});
async function run(command){const start=performance.now();const child=spawn(process.env.ComSpec,['/d','/s','/c',command],{cwd:root,stdio:'inherit',windowsHide:true,windowsVerbatimArguments:true});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});assert.equal(code,0,command);return (performance.now()-start)/1000;}
await run('pnpm exec turbo run build --filter=bb-app --output-logs=new-only');
const install=join(process.env.RUNNER_TEMP,'native-typescript');
await run(`npm install --prefix "${install}" --ignore-scripts --no-audit --no-fund typescript@7.1.0-dev.20260930.4`);
const file='packages/bb-app/scripts/build-public-sdk-dts.mjs',original=await readFile(file,'utf8');
let candidate=original.replace(/const supportsNativeCompiler =[\s\S]*?const tempRoot =/, 'const supportsNativeCompiler = true;\nconst tempRoot =').replace(/const compiler = fileURLToPath\([\s\S]*?\n  \);/,`const compiler = ${JSON.stringify(join(install,'node_modules/typescript/bin/tsc'))};`);
assert.notEqual(candidate,original);
const results=[];
try{for(const label of process.env.PROBE_ORDER.split(',')){await writeFile(file,label==='baseline'?original:candidate);const seconds=await run('node packages/bb-app/scripts/build-public-sdk-dts.mjs');const bytes=await readFile('packages/bb-app/dist/index.d.ts');await writeFile(join(output,label+'.d.ts'),bytes);results.push({label,seconds,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});console.log('DECLARATION_RESULT',JSON.stringify(results.at(-1)));}await writeFile(join(output,'summary.json'),JSON.stringify(results,null,2));assert.equal(results[0].sha256,results[1].sha256,'Entire public declaration bytes must match');}finally{await writeFile(file,original);}
