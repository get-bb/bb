import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it, onTestFinished, vi } from "vitest";
import { stopWindowsProcessTree } from "../src/windows-process-tree.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((...args: unknown[]) => {
      const callback = args.at(-1);
      queueMicrotask(() => {
        if (typeof callback === "function") {
          callback(new Error("taskkill unavailable"), "", "");
        }
      });
      return new actual.ChildProcess();
    }),
  };
});

async function startChild() {
  const child = spawn(
    process.execPath,
    ["-e", 'process.stdout.write("ready"); setInterval(() => {}, 1000);'],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  onTestFinished(() => {
    vi.restoreAllMocks();
    child.kill("SIGKILL");
    vi.mocked(execFile).mockClear();
  });
  await once(child.stdout, "data");
  return child;
}

it("reports unverified tree cleanup when taskkill fails but the root exits", async () => {
  const child = await startChild();
  await expect(stopWindowsProcessTree(child)).resolves.toEqual({
    treeTermination: "unverified",
  });
  expect(child.signalCode).toBe("SIGKILL");
});

it("falls back within a deadline when taskkill never completes", async () => {
  const child = await startChild();
  const killer = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      stdio: "ignore",
    },
  );
  onTestFinished(() => {
    killer.kill("SIGKILL");
  });
  vi.mocked(execFile).mockReturnValueOnce(killer);
  await expect(stopWindowsProcessTree(child)).resolves.toEqual({
    treeTermination: "unverified",
  });
  expect(child.signalCode).toBe("SIGKILL");
});

it("rejects within a deadline when taskkill and root termination both fail", async () => {
  const child = await startChild();
  vi.spyOn(child, "kill").mockReturnValue(false);
  await expect(stopWindowsProcessTree(child)).rejects.toThrow(
    "Process did not exit after termination",
  );
}, 3_000);

it("does not target a recycled PID after the root has exited", async () => {
  const child = await startChild();
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  await expect(stopWindowsProcessTree(child)).resolves.toEqual({
    treeTermination: "unverified",
  });
  expect(execFile).not.toHaveBeenCalled();
});
