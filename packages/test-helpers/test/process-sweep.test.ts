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
import {
  killProcessesReferencingPath,
  signalDescendantProcesses,
} from "../src/process-sweep.js";

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

describe.skipIf(process.platform === "win32")(
  "signalDescendantProcesses",
  () => {
    it("signals the selected grandchildren of this process and no others", async () => {
      const lifeline = await createProcessLifeline();
      onTestFinished(() => lifeline.close());
      const grandchild = (label: string) =>
        `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(
          `${lifeline.holdSource(label)} setInterval(() => {}, 1000);`,
        )}, ${JSON.stringify(label)}], { stdio: 'ignore' });`;
      const parent = spawn(
        process.execPath,
        [
          "-e",
          `${grandchild("target")} ${grandchild("bystander")} setInterval(() => {}, 1000);`,
        ],
        { stdio: "ignore" },
      );
      onTestFinished(() => {
        parent.kill("SIGKILL");
      });
      const holders = await lifeline.waitForHolders(2);
      const target = holders.find((holder) => holder.label === "target");
      const bystander = holders.find((holder) => holder.label === "bystander");

      const signalled = await signalDescendantProcesses({
        select: (entry, entryParent) =>
          entryParent?.pid === parent.pid && entry.args.endsWith(" target"),
        signal: "SIGKILL",
      });
      await target?.exited;

      expect(signalled.map((entry) => entry.pid)).toEqual([target?.pid]);
      expect(bystander?.alive()).toBe(true);
      expect(hasExited(parent)).toBe(false);
    });
  },
);
