import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { killProcessesReferencingPath } from "../src/process-sweep.js";

const roots: string[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPid(path: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pid = Number(await readFile(path, "utf8").catch(() => ""));
    if (pid > 0) return pid;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function spawnStubborn(marker: string, childPidPath: string): number {
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "process.on('SIGTERM', () => {});",
        "const { spawn } = require('node:child_process');",
        "const fs = require('node:fs');",
        "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { detached: true, stdio: 'ignore' });",
        "fs.writeFileSync(process.argv[2], String(grandchild.pid));",
        "setInterval(() => {}, 1000);",
      ].join(" "),
      marker,
      childPidPath,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  return child.pid!;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await killProcessesReferencingPath(root, { graceMs: 0 });
    await rm(root, { force: true, recursive: true });
  }
});

describe.skipIf(process.platform === "win32")(
  "killProcessesReferencingPath",
  () => {
    it("kills a SIGTERM-ignoring process and its detached descendants, sparing paths that only share a prefix", async () => {
      const root = await mkdtemp(join(tmpdir(), "bb-sweep-"));
      const sibling = `${root}-sibling`;
      roots.push(root, sibling);
      const target = spawnStubborn(join(root, "marker"), join(root, "child"));
      const bystander = spawnStubborn(sibling, `${sibling}.child`);
      const grandchild = await waitForPid(join(root, "child"));
      const bystanderChild = await waitForPid(`${sibling}.child`);

      const killed = await killProcessesReferencingPath(root, {
        graceMs: 200,
      });

      expect(killed).toEqual(expect.arrayContaining([target, grandchild]));
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (!isAlive(target) && !isAlive(grandchild)) break;
        await sleep(50);
      }
      expect(isAlive(target)).toBe(false);
      expect(isAlive(grandchild)).toBe(false);
      expect(isAlive(bystander)).toBe(true);
      expect(isAlive(bystanderChild)).toBe(true);
    });
  },
);
