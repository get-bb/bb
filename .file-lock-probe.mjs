import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from './packages/config/src/file-lock.ts';
const directory = await mkdtemp(join(tmpdir(), 'bb-lock 日本語 '));
const path = join(directory, 'config.lock');
const retained = process.argv.includes('--retained');
const moduleUrl = new URL('./packages/config/src/file-lock.ts', import.meta.url).href;
const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', `
import { withFileLock } from ${JSON.stringify(moduleUrl)};
process.on('message', async () => {
 for (let i = 0; i < 3; i++) { global.gc(); await new Promise(resolve => setImmediate(resolve)); }
 process.send('collected');
});
await withFileLock({ path: ${JSON.stringify(path)}, timeoutMs: 1000, work: async () => {
 process.send('locked');
 ${retained ? "process.stdin.resume(); await new Promise(resolve => process.stdin.once('end', resolve));" : 'await new Promise(() => setInterval(() => {}, 1000));'}
}});
`], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
const closed = once(child, 'close');
child.stderr.on('data', chunk => process.stderr.write(chunk));
try {
 console.log({retained, ready: await once(child, 'message')});
 const collected = once(child, 'message');
 child.send('gc');
 console.log({collected: await collected});
 let entered = false;
 try { await withFileLock({path, timeoutMs: 100, work: async () => { entered = true; console.log('COMPETING LOCK ENTERED'); }}); }
 catch (error) { console.log(error.constructor.name); }
 assert.equal(entered, !retained);
 assert.equal(child.exitCode, null);
 console.log({exitCode: child.exitCode});
 child.kill('SIGKILL');
 await closed;
 console.log(await withFileLock({path, timeoutMs:1000,work:async()=> 'reacquired after kill'}));
} finally { child.kill('SIGKILL'); await closed; await rm(directory,{recursive:true,force:true}); }
