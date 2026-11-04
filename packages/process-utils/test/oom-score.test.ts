import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, onTestFinished } from "vitest";
import { preferOutOfMemoryKill } from "../src/oom-score.js";

function readOomScoreAdj(pid: number | "self"): number {
  return Number(readFileSync(`/proc/${pid}/oom_score_adj`, "utf8"));
}

describe.runIf(process.platform === "linux")("preferOutOfMemoryKill", () => {
  it("ranks the child ahead of its parent for the out-of-memory killer", () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
      stdio: "ignore",
    });
    onTestFinished(() => {
      child.kill("SIGKILL");
    });
    if (child.pid === undefined) throw new Error("child did not start");

    preferOutOfMemoryKill(child.pid);

    expect(readOomScoreAdj(child.pid)).toBe(
      Math.min(1_000, readOomScoreAdj("self") + 500),
    );
  });

  it("ignores a child that has already exited", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid;
    await once(child, "exit");

    expect(() => preferOutOfMemoryKill(pid)).not.toThrow();
  });
});
