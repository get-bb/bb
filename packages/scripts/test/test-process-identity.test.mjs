import { describe, expect, it } from "vitest";
import {
  findProcessIdentityChecks,
  isTestSource,
} from "../../../scripts/check-test-process-identity.mjs";

const rulesIn = (source) =>
  [
    ...new Set(
      findProcessIdentityChecks(source).map((finding) => finding.rule),
    ),
  ].sort();

describe("findProcessIdentityChecks on checks that past fixes removed", () => {
  it.each([
    [
      "#7681 Codex app-server teardown",
      `function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ESRCH") {
      return false;
    }
    throw error;
  }
}
while (childPids.some(processIsAlive)) {}`,
      ["pid-liveness-helper", "signal-zero-probe"],
    ],
    [
      "#7681 ACP descendant check",
      `expect(process.kill(descendantPid, 0)).toBe(true);`,
      ["signal-zero-probe"],
    ],
    [
      "#7683 restarted host worker",
      `expect(Reflect.get(Object(restarted.output), "pid")).not.toBe(firstPid);`,
      ["pid-identity-assertion"],
    ],
    [
      "#5052 replacement provider",
      `expect(replacementProvider.child.pid).not.toBe(exitedPid);`,
      ["pid-identity-assertion"],
    ],
    [
      "#5487 server-move pending server",
      `expect(isProcessGroupAlive(prepared.pid)).toBe(false);`,
      ["pid-liveness-helper"],
    ],
    [
      "#6248 runtime shutdown",
      `function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
expect(processIsAlive(replacementProcess.child.pid ?? 0)).toBe(false);`,
      ["pid-liveness-helper", "signal-zero-probe"],
    ],
    [
      "imported PID helper",
      `expect(isProcessRunning(args.pid)).toBe(true);`,
      ["pid-liveness-helper"],
    ],
    [
      "PID helper passed as a callback",
      `return processIds.every((pid) => !isProcessRunning(pid)) && pids.some(isAlive);`,
      ["pid-liveness-helper"],
    ],
    [
      "a probe split across lines",
      `process.kill(
  busy.child.pid!,
  0,
);`,
      ["signal-zero-probe"],
    ],
    [
      "an assertion split across lines",
      `expect(
  restartedDaemonPid,
)
  .not.toBe(firstDaemonPid);`,
      ["pid-identity-assertion"],
    ],
  ])("finds the %s", (_name, source, rules) => {
    expect(rulesIn(source)).toEqual(rules);
  });
});

describe("findProcessIdentityChecks on handle-based checks", () => {
  it.each([
    [
      "an owned exit state",
      `expect(child.exitCode !== null || child.signalCode !== null).toBe(true);`,
    ],
    ["a real signal", `process.kill(pid, "SIGKILL");`],
    ["a boot identity", `expect(restarted.bootId).not.toBe(firstBootId);`],
    ["a present PID", `expect(pid).not.toBeNull();`],
    [
      "a lifeline holder",
      `await holder.exited; expect(holder.alive()).toBe(false);`,
    ],
    [
      "a group probe through the owned leader",
      `expect(isProcessGroupAlive(child)).toBe(true);`,
    ],
    ["a tracker query", `expect(tracker.running()).toEqual([]);`],
    ["an unrelated inequality", `expect(next.title).not.toBe(previous.title);`],
    [
      "a PID file name",
      `expect(hasLiveOwner(join(root, "parent.pid"))).toBe(true);`,
    ],
  ])("accepts %s", (_name, source) => {
    expect(rulesIn(source)).toEqual([]);
  });

  it("reports the line of each finding", () => {
    expect(
      findProcessIdentityChecks("const a = 1;\n\nprocess.kill(pid, 0);\n"),
    ).toMatchObject([{ line: 3, rule: "signal-zero-probe" }]);
  });
});

describe("isTestSource", () => {
  it.each([
    "apps/server/test/app/install-machine-script.test.ts",
    "packages/agent-runtime/src/runtime.process-lifecycle.test.ts",
    "plugins/provider-codex/src/bridge/bridge-process.test-support.ts",
    "packages/frp-client/src/testing/frp-fixture.ts",
    "packages/test-helpers/src/process-sweep.ts",
    "apps/host-daemon/src/server-move/test-fixture.ts",
    "tests/integration/global-setup.ts",
    "tests/qa/src/shared.ts",
    "packages/scripts/test/start-bb.test.mjs",
  ])("treats %s as test code", (path) => {
    expect(isTestSource(path)).toBe(true);
  });

  it.each([
    "packages/config/src/verified-process-stop.ts",
    "apps/host-daemon/src/server-move/pending-server.ts",
    "packages/scripts/src/lib/pid-file.ts",
    "docs/debugging-and-qa.md",
  ])("leaves production file %s alone", (path) => {
    expect(isTestSource(path)).toBe(false);
  });
});
