import {createHash} from 'node:crypto';
import {lstat,readdir,readlink,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
async function baseline(resources) {
  const started = performance.now();
  const hash = createHash("sha256");
  async function visit(file) {
    const stat = await lstat(file);
    hash.update(JSON.stringify([file, stat.mode]));
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort())
        await visit(join(file, name));
    } else {
      hash.update(
        stat.isSymbolicLink() ? await readlink(file) : await readFile(file),
      );
    }
  }
  await visit(join(resources, "app.asar"));
  await visit(join(resources, "app.asar.unpacked"));
  console.log("PROFILE resource hashing", performance.now() - started);
  return hash.digest("hex");
}

async function candidate(resources) {
  const hash = createHash("sha256");
  const files = [];
  async function visit(file, directory) {
    files.push(file);
    if (!directory) return;
    const entries = await readdir(file, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries)
      await visit(join(file, entry.name), entry.isDirectory());
  }
  await visit(join(resources, "app.asar"), false);
  await visit(join(resources, "app.asar.unpacked"), true);
  for (let offset = 0; offset < files.length; offset += 16) {
    const entries = await Promise.all(files.slice(offset, offset + 16).map(async (file) => {
      const stat = await lstat(file);
      const content = stat.isDirectory() ? null : stat.isSymbolicLink() ? await readlink(file) : await readFile(file);
      return { file, mode: stat.mode, content };
    }));
    for (const { file, mode, content } of entries) {
      hash.update(JSON.stringify([file, mode]));
      if (content !== null) hash.update(content);
    }
  }
  return hash.digest("hex");
}

const resources=resolve('apps/desktop/release/win-unpacked/resources');
let expected;
for (const hash of [baseline,candidate,candidate,baseline]) {
 const started=performance.now(); const result=await hash(resources);
 if (expected) assert.equal(result,expected); expected=result;
 console.log('HASH',hash.name,performance.now()-started,result);
}
