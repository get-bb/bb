import assert from "node:assert/strict";
import { readFile, rename, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import afterPack from "../apps/desktop/scripts/prepare-native-modules.cjs";
const appOutDir=resolve("apps/desktop/release/win-unpacked");
const modules=join(appOutDir,"resources/app.asar.unpacked/node_modules");
const context={appOutDir,electronPlatformName:"win32",arch:1,packager:{appInfo:{productFilename:"bb"}}};
const npmManifest=join(modules,"npm/package.json");
await rename(npmManifest,npmManifest+".probe");
try {
 await assert.rejects(afterPack(context),/Cannot find module|Dependency escaped artifact/);
 console.log("PROBE mutation missing packaged npm caught by retained afterPack");
} finally { await rename(npmManifest+".probe",npmManifest); }
const npmCli=join(modules,"npm/bin/npm-cli.js");
const original=await readFile(npmCli,"utf8");
const mutation=join(modules,"bb-ci-mutated-resource");
await writeFile(npmCli,original.replace("\n", "\nrequire('node:fs').writeFileSync("+JSON.stringify(mutation)+", 'mutation');\n"));
try {
 await assert.rejects(afterPack(context),/Plugin dependency install\/update modified packaged resources/);
 console.log("PROBE mutation npm changed packaged resources caught by retained afterPack");
} finally { await writeFile(npmCli,original); await rm(mutation,{force:true}); }
