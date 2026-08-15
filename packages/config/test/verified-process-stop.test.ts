import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createNodeVerifiedProcessOps,
  parseElapsedSeconds,
  readWindowsProcessIdentity,
} from "../src/verified-process-stop.js";

describe("parseElapsedSeconds", () => {
  it("parses ps etime", () => {
    expect(parseElapsedSeconds("01:02")).toBe(62);
  });
});

describe("createNodeVerifiedProcessOps", () => {
  it.skipIf(process.platform !== "win32")(
    "does not use ps on win32 and can read this process",
    async () => {

    const identity = await readWindowsProcessIdentity(process.pid);
    expect(identity.command).toEqual(expect.stringMatching(/node/i));
    expect(identity.elapsedSeconds).toEqual(expect.any(Number));

    const ops = createNodeVerifiedProcessOps("win32");
    const fromOps = await ops.readIdentity(process.pid);
    expect(fromOps.command).toEqual(expect.stringMatching(/node/i));
    },
    20_000,
  );

  it.skipIf(process.platform !== "win32")(
    "kills grandchild processes on win32",
    async () => {

    const parent = spawn(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('node:child_process');const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(g.pid));setInterval(()=>{},1000);",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const parentPid = parent.pid;
    expect(parentPid).toEqual(expect.any(Number));
    const grandchildPid = Number(
      await new Promise<string>((resolvePromise, rejectPromise) => {
        let stdout = "";
        parent.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          if (stdout.length > 0) {
            resolvePromise(stdout);
          }
        });
        parent.once("error", rejectPromise);
        setTimeout(() => {
          rejectPromise(new Error("grandchild pid timeout"));
        }, 5_000);
      }),
    );
    expect(grandchildPid).toBeGreaterThan(0);

    const ops = createNodeVerifiedProcessOps("win32");
    ops.kill(parentPid as number, "SIGTERM");
    await expect(
      ops.waitForExit({ pid: parentPid as number, timeoutMs: 5_000 }),
    ).resolves.toBe(true);
    await expect(
      ops.waitForExit({ pid: grandchildPid, timeoutMs: 5_000 }),
    ).resolves.toBe(true);
    },
    20_000,
  );
});
