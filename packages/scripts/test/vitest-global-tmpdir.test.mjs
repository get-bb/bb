import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import setupTmpdirSandbox from "../../../vitest.global-tmpdir.ts";

const ACTIVE = Symbol.for("@bb/vitest-tmpdir-sandbox");

function detachLiveSandbox() {
  const liveSandbox = globalThis[ACTIVE];
  const liveTmpdir = process.env.TMPDIR;
  delete globalThis[ACTIVE];
  return () => {
    if (liveSandbox === undefined) delete globalThis[ACTIVE];
    else globalThis[ACTIVE] = liveSandbox;
    if (liveTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = liveTmpdir;
  };
}

describe("vitest tmpdir sandbox", () => {
  let restoreLiveSandbox = null;

  afterEach(() => {
    restoreLiveSandbox?.();
    restoreLiveSandbox = null;
  });

  it("shares one sandbox across projects and deletes it after the last teardown", () => {
    restoreLiveSandbox = detachLiveSandbox();
    const outerTmpdir = process.env.TMPDIR;

    const teardownFirst = setupTmpdirSandbox();
    const root = process.env.TMPDIR;
    expect(root).toBeDefined();
    expect(root).not.toBe(outerTmpdir);
    expect(existsSync(root)).toBe(true);

    const teardownSecond = setupTmpdirSandbox();
    expect(process.env.TMPDIR).toBe(root);

    writeFileSync(path.join(root, "leaked.txt"), "leak");

    teardownFirst();
    expect(process.env.TMPDIR).toBe(root);
    expect(existsSync(root)).toBe(true);

    teardownSecond();
    expect(existsSync(root)).toBe(false);
    expect(process.env.TMPDIR).toBe(outerTmpdir);
  });
});
