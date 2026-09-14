import { describe, expect, it, vi } from "vitest";
import { createNodeGitRunner, hardenedGitEnvironment } from "./run.js";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

interface CapturedExecOptions {
  timeout?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
  env?: NodeJS.ProcessEnv;
}

let capturedOptions: CapturedExecOptions | undefined;

function installSuccess(): void {
  capturedOptions = undefined;
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: readonly string[],
      options: CapturedExecOptions,
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      capturedOptions = options;
      callback(null, "ok", "");
    },
  );
}

describe("createNodeGitRunner hardening", () => {
  it("spawns git with GIT_OPTIONAL_LOCKS=0, a hidden window, and bounded time and output", async () => {
    installSuccess();
    const runner = createNodeGitRunner("git");
    const result = await runner(["log", "-n", "1"], {
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    expect(execFileMock).toHaveBeenCalledOnce();
    expect(capturedOptions?.env?.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(capturedOptions?.windowsHide).toBe(true);
    expect(capturedOptions?.timeout).toBe(5_000);
    expect(capturedOptions?.maxBuffer).toBe(1024);
  });

  it("keeps the inherited environment and always forces the lock setting off", () => {
    const env = hardenedGitEnvironment({
      PATH: "C:/bin",
      CUSTOM: "yes",
      GIT_OPTIONAL_LOCKS: "1",
    });
    expect(env).toEqual({
      PATH: "C:/bin",
      CUSTOM: "yes",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });
});
