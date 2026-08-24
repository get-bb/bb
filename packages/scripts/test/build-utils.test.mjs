import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneUnreferencedChunks } from "../../../scripts/build-utils.mjs";

describe("pruneUnreferencedChunks", () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the chunks the entry reaches and removes a previous build's", async () => {
    const dist = mkdtempSync(join(tmpdir(), "bb-prune-chunks-"));
    tempDirs.push(dist);
    const chunkDir = join(dist, "bb-chunks");
    mkdirSync(chunkDir);
    const entry = join(dist, "bb");

    // The minified shapes esbuild emits: a static import with no whitespace,
    // a lazy import(), a re-export and a bare side-effect import, plus a
    // cycle between shared chunks (chunk-A <-> chunk-C).
    writeFileSync(
      entry,
      '#!/usr/bin/env node\nimport{a as U}from"./bb-chunks/chunk-A.js";U(()=>import("./bb-chunks/thread-B.js"));\n',
    );
    writeFileSync(
      join(chunkDir, "chunk-A.js"),
      'import{b}from"./chunk-C.js";export{b as a};\n',
    );
    writeFileSync(
      join(chunkDir, "thread-B.js"),
      'export * from "./chunk-A.js";\nimport"./chunk-D.js";\n',
    );
    writeFileSync(
      join(chunkDir, "chunk-C.js"),
      'import"./chunk-A.js";export var b=1;\n',
    );
    writeFileSync(join(chunkDir, "chunk-C.js.map"), "{}");
    writeFileSync(join(chunkDir, "chunk-D.js"), "export var d=1;\n");
    // Stale generation: an unreferenced command chunk and a shared chunk
    // that itself still imports a live chunk, with its sourcemap.
    writeFileSync(join(chunkDir, "thread-OLD.js"), "export var old=1;\n");
    writeFileSync(
      join(chunkDir, "chunk-STALE.js"),
      'import"./chunk-C.js";export var s=1;\n',
    );
    writeFileSync(join(chunkDir, "chunk-STALE.js.map"), "{}");

    const removed = await pruneUnreferencedChunks({ chunkDir, entry });

    expect(removed.sort()).toEqual([
      join(chunkDir, "chunk-STALE.js"),
      join(chunkDir, "chunk-STALE.js.map"),
      join(chunkDir, "thread-OLD.js"),
    ]);
    expect(readdirSync(chunkDir).sort()).toEqual([
      "chunk-A.js",
      "chunk-C.js",
      "chunk-C.js.map",
      "chunk-D.js",
      "thread-B.js",
    ]);
  });

  it("removes nothing from a clean build", async () => {
    const dist = mkdtempSync(join(tmpdir(), "bb-prune-chunks-"));
    tempDirs.push(dist);
    const chunkDir = join(dist, "bb-chunks");
    mkdirSync(chunkDir);
    const entry = join(dist, "bb");
    writeFileSync(entry, 'import"./bb-chunks/chunk-A.js";\n');
    writeFileSync(join(chunkDir, "chunk-A.js"), "export var a=1;\n");

    await expect(pruneUnreferencedChunks({ chunkDir, entry })).resolves.toEqual(
      [],
    );
    expect(readdirSync(chunkDir)).toEqual(["chunk-A.js"]);
  });

  it("refuses to prune when the entry reaches no chunk", async () => {
    const dist = mkdtempSync(join(tmpdir(), "bb-prune-chunks-"));
    tempDirs.push(dist);
    const chunkDir = join(dist, "bb-chunks");
    mkdirSync(chunkDir);
    const entry = join(dist, "bb");
    // A chunk extension the specifier regex does not recognise: every chunk
    // then looks unreferenced, and a wipe here would only surface later as
    // ERR_MODULE_NOT_FOUND from the packed `bb`.
    writeFileSync(entry, 'import{a}from"./bb-chunks/chunk-A.mjs";\n');
    writeFileSync(join(chunkDir, "chunk-A.mjs"), "export var a=1;\n");

    await expect(pruneUnreferencedChunks({ chunkDir, entry })).rejects.toThrow(
      /references no chunk/,
    );
    expect(readdirSync(chunkDir)).toEqual(["chunk-A.mjs"]);
  });
});
