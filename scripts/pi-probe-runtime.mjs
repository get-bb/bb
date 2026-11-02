import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(resolve('plugins/provider-pi/package.json'));
const dist = process.env.BB_PI_PROBE_DIST || dirname(require.resolve('@earendil-works/pi-coding-agent'));
const logger = String.raw`
let __bbSequence = 0;
function __bbLog(event, data = {}) {
  const dir = process.env.BB_PI_RUNTIME_PROBE_DIR;
  if (!dir) return;
  try {
    __bbMkdir(dir, { recursive: true });
    __bbAppend(__bbJoin(dir, 'runtime-' + process.pid + '.jsonl'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...data }) + '\n');
  } catch {}
}
`;
const helper = `
import { appendFileSync as __bbAppend, mkdirSync as __bbMkdir } from 'node:fs';
import { join as __bbJoin } from 'node:path';
${logger}
function __bbWrap(target, key, label, details = () => ({})) {
  const original = target[key];
  target[key] = function(...args) {
    const id = ++__bbSequence;
    const started = Date.now();
    __bbLog(label + ':start', { id, ...details.call(this, args) });
    let value;
    try { value = original.apply(this, args); }
    catch(error) { __bbLog(label + ':error', { id, ms: Date.now() - started, code: error?.code, name: error?.name }); throw error; }
    if (value && typeof value.then === 'function') {
      value.then(
        () => __bbLog(label + ':end', { id, ms: Date.now() - started }),
        error => __bbLog(label + ':error', { id, ms: Date.now() - started, code: error?.code, name: error?.name })
      );
    } else __bbLog(label + ':end', { id, ms: Date.now() - started });
    return value;
  };
}
`;
const patches = {
 'core/model-runtime.js': `
__bbWrap(ModelRuntime, 'create', 'model.create');
__bbWrap(ModelRuntime.prototype, 'refresh', 'model.refresh', ([options]) => ({ allowNetwork: options?.allowNetwork, hasSignal: Boolean(options?.signal) }));
__bbWrap(ModelRuntime.prototype, 'queueAvailabilityRefresh', 'model.availability');
`,
 'core/resource-loader.js': `__bbWrap(DefaultResourceLoader.prototype, 'reload', 'resources.reload');`,
 'core/settings-manager.js': `__bbWrap(SettingsManager.prototype, 'reload', 'settings.reload');`,
 'core/auth-storage.js': '',
 'core/sdk.js': `
const __bbSdkMethods = { createAgentSession };
__bbWrap(__bbSdkMethods, 'createAgentSession', 'session.create');
createAgentSession = __bbSdkMethods.createAgentSession;
`,
};
function replaceOnce(source, search, replacement) {
 if(source.split(search).length !== 2) throw new Error('expected exactly one match: '+search);
 return source.replace(search, replacement);
}
function save(path, source, updated) {
 if(source.includes('function __bbLog(')) throw new Error('already instrumented: '+path);
 writeFileSync(path+'.bb-probe-original',source);
 writeFileSync(path,updated);
 console.log('instrumented',path);
}
for(const [relative, appended] of Object.entries(patches)) {
 const path = join(dist, relative);
 const source = readFileSync(path,'utf8');
 let updated = source;
 if(relative === 'core/auth-storage.js') {
  updated = replaceOnce(updated, '    async acquireLockAsync(signal, onCompromised) {', `    async acquireLockAsync(signal, onCompromised) {
        const __bbStarted = Date.now();
        __bbLog('lock.acquire:start', { path: this.authPath, hasSignal: Boolean(signal) });`);
  updated = replaceOnce(updated, '                    onCompromised,\n                });', `                    onCompromised,
                });
                __bbLog('lock.acquire:end', { path: this.authPath, ms: Date.now() - __bbStarted });`);
  updated = replaceOnce(updated, '                const remainingMs = deadline - Date.now();', `                __bbLog('lock.acquire:retry', { path: this.authPath, code, ms: Date.now() - __bbStarted });
                const remainingMs = deadline - Date.now();`);
  if(updated.split('await release();').length !== 3) throw new Error('expected two async release sites');
  updated = updated.replaceAll('await release();', `__bbLog('lock.release:start', { path: this.authPath });
                    await release();
                    __bbLog('lock.release:end', { path: this.authPath });`);
 }
 save(path,source,updated+'\n'+helper+'\n'+appended);
}
const lockPath = process.env.BB_PI_PROBE_LOCKFILE || createRequire(join(dist,'core/auth-storage.js')).resolve('proper-lockfile/lib/lockfile.js');
const lockSource = readFileSync(lockPath,'utf8');
let lockUpdated = lockSource;
lockUpdated = replaceOnce(lockUpdated, '    options.fs.mkdir(lockfilePath, (err) => {', `    __bbLog('lockfs.mkdir:start', { path: file, lockfilePath });
    options.fs.mkdir(lockfilePath, (err) => {
        __bbLog('lockfs.mkdir:end', { path: file, lockfilePath, code: err && err.code });`);
lockUpdated = replaceOnce(lockUpdated, '                callback(null, mtime, mtimePrecision);', `                __bbLog('lockfs.probe:end', { path: file, lockfilePath });
                callback(null, mtime, mtimePrecision);`);
lockUpdated = replaceOnce(lockUpdated, '                // We must keep the lock fresh to avoid staleness\n                updateLock(file, options);', `                __bbLog('lockfs.registered', { path: file });
                updateLock(file, options);`);
lockUpdated = replaceOnce(lockUpdated, '    options.fs.rmdir(getLockFile(file, options), (err) => {', `    __bbLog('lockfs.rmdir:start', { path: file });
    options.fs.rmdir(getLockFile(file, options), (err) => {
        __bbLog('lockfs.rmdir:end', { path: file, code: err && err.code });`);
lockUpdated += `
const { appendFileSync: __bbAppend, mkdirSync: __bbMkdir } = require('node:fs');
const { join: __bbJoin } = require('node:path');
${logger}
process.on('exit', code => __bbLog('lockfs.exit', { code, registered: Object.keys(locks) }));
`;
save(lockPath,lockSource,lockUpdated);
