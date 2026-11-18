import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import { preferOutOfMemoryKill } from "../src/oom-score.js";

function readOwnOomScoreAdj(): number {
  return Number(readFileSync("/proc/self/oom_score_adj", "utf8"));
}

describe.runIf(process.platform === "linux")("preferOutOfMemoryKill", () => {
  it("ranks the child ahead of its parent for the out-of-memory killer", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.stdin.once("data", () => process.stdout.write(require("node:fs").readFileSync("/proc/self/oom_score_adj", "utf8")));',
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    onTestFinished(() => {
      child.kill("SIGKILL");
    });
    if (child.pid === undefined) throw new Error("child did not start");
    const reported = once(child.stdout, "data");

    preferOutOfMemoryKill(child.pid);
    child.stdin.write("report\n");

    expect(Number(String((await reported)[0]))).toBe(
      Math.min(1_000, readOwnOomScoreAdj() + 500),
    );
  });

  it("ignores a child that has already exited", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid;
    await once(child, "exit");

    expect(() => preferOutOfMemoryKill(pid)).not.toThrow();
  });
});
