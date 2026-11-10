const Module = require('node:module');
const original = Module._load;
const wrapped = new WeakSet();
function wrap(object, key, label) {
  const fn = object?.[key];
  if (typeof fn !== 'function' || wrapped.has(fn)) return;
  const next = async function(...args) {
    const start = performance.now();
    try { return await fn.apply(this,args); }
    finally { console.log(`PROFILE ${label}.${key} ${(performance.now()-start).toFixed(0)}ms`); }
  };
  wrapped.add(next); object[key] = next;
}
Module._load = function(request,...args) {
 const value = original.call(this,request,...args);
 if (request.includes('appFileCopier')) for (const key of ['computeFileSets','computeNodeModuleFileSets','copyAppFiles','transformFiles']) wrap(value,key,'files');
 if (request.includes('asarUtil')) for (const key of ['pack','processFileSets','executeElectronAsar']) wrap(value.AsarPackager?.prototype,key,'asar');
 if (request.includes('platformPackager')) for (const key of ['doPack','sanityCheckPackage','doSignAfterPack']) wrap(value.PlatformPackager?.prototype,key,'platform');
 return value;
};
process.env.NODE_OPTIONS = `--require "${__filename.replaceAll(String.fromCharCode(92), "/")}"`;
