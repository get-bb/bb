import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import {
  createProcessLifeline,
  hasExited,
  waitForExit,
  type ProcessLifeline,
} from "../src/child-processes.js";
import { killProcessesReferencingPath } from "../src/process-sweep.js";

const roots: string[] = [];

function spawnStubborn(
  lifeline: ProcessLifeline,
  marker: string,
  descendantLabel: string,
): ChildProcess {
  const descendant = `process.on('SIGTERM', () => {}); ${lifeline.holdSource(descendantLabel)} setInterval(() => {}, 1000);`;
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "process.on('SIGTERM', () => {});",
        "const { spawn } = require('node:child_process');",
        `spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { detached: true, stdio: 'ignore' });`,
        "setInterval(() => {}, 1000);",
      ].join(" "),
      marker,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  return child;
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
      const lifeline = await createProcessLifeline();
      onTestFinished(() => lifeline.close());
      const target = spawnStubborn(lifeline, join(root, "marker"), "target");
      const bystander = spawnStubborn(lifeline, sibling, "bystander");
      const holders = await lifeline.waitForHolders(2);
      const grandchild = holders.find((holder) => holder.label === "target");
      const bystanderChild = holders.find(
        (holder) => holder.label === "bystander",
      );

      const killed = await killProcessesReferencingPath(root, {
        graceMs: 200,
      });

      expect(killed).toEqual(
        expect.arrayContaining([target.pid, grandchild?.pid]),
      );
      await Promise.all([waitForExit(target), grandchild?.exited]);
      expect(hasExited(bystander)).toBe(false);
      expect(bystanderChild?.alive()).toBe(true);
    });
  },
);
