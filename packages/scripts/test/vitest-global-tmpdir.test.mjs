import { spawn } from "node:child_process";
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

  it("shares one sandbox across projects and deletes it after the last teardown", async () => {
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

    await teardownFirst();
    expect(process.env.TMPDIR).toBe(root);
    expect(existsSync(root)).toBe(true);

    await teardownSecond();
    expect(existsSync(root)).toBe(false);
    expect(process.env.TMPDIR).toBe(outerTmpdir);
  });

  it.skipIf(process.platform === "win32")(
    "kills processes still running from the sandbox at the last teardown",
    async () => {
      restoreLiveSandbox = detachLiveSandbox();
      const teardown = setupTmpdirSandbox();
      const root = process.env.TMPDIR;
      const child = spawn(
        process.execPath,
        [
          "-e",
          "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);",
          path.join(root, "leaked-daemon"),
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const exited = new Promise((resolve) => child.once("exit", resolve));
      await new Promise((resolve) => child.stdout.once("data", resolve));

      await teardown();

      await exited;
      expect(child.signalCode).toBe("SIGKILL");
    },
  );
});
