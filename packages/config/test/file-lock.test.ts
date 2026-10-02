import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { FileLockTimeoutError, withFileLock } from "../src/file-lock.js";

it("excludes another process and releases a native lock when its owner dies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bb-lock 日本語 "));
  const path = join(directory, "config.lock");
  const moduleUrl = new URL("../src/file-lock.ts", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { withFileLock } from ${JSON.stringify(moduleUrl)};
     await withFileLock({ path: ${JSON.stringify(path)}, timeoutMs: 1000, work: async () => {
       process.stdout.write("locked");
       await new Promise(() => setInterval(() => {}, 1000));
     }});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  onTestFinished(async () => {
    child.kill("SIGKILL");
    await closed;
    await rm(directory, { recursive: true, force: true });
  });
  const ready = await Promise.race([
    once(child.stdout, "data").then(([chunk]) => String(chunk)),
    closed.then(() => {
      throw new Error("Lock owner exited before acquiring the lock");
    }),
  ]);
  expect(ready).toBe("locked");
  let entered = false;
  await expect(
    withFileLock({
      path,
      timeoutMs: 100,
      work: async () => {
        entered = true;
      },
    }),
  ).rejects.toBeInstanceOf(FileLockTimeoutError);
  expect(entered).toBe(false);
  child.kill("SIGKILL");
  await closed;
  await expect(
    withFileLock({ path, timeoutMs: 1000, work: async () => "reacquired" }),
  ).resolves.toBe("reacquired");
}, 15_000);
