import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit, WorkspaceError } from "../src/workspace-git.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("@get-bb/plugin-sdk/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/host")>();
  return { ...actual, experimental_spawnPortableOutputProcess: spawnMock };
});

const STATUS_DLL_INIT_FAILED = 0xc0000142;
const STATUS_ACCESS_VIOLATION = 0xc0000005;

function gitExit({
  code,
  stdout = "",
  stderr = "",
}: {
  code: number;
  stdout?: string;
  stderr?: string;
}): () => EventEmitter {
  return () => {
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    setImmediate(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      setImmediate(() => child.emit("close", code, null));
    });
    return child;
  };
}

afterEach(() => {
  spawnMock.mockReset();
});

describe("runGit Windows startup crash retries", () => {
  it("retries a silent Windows process startup crash", async () => {
    spawnMock
      .mockImplementationOnce(gitExit({ code: STATUS_DLL_INIT_FAILED }))
      .mockImplementationOnce(gitExit({ code: 0, stdout: "ok\n" }));

    const result = await runGit(["status"], { cwd: "/repo" });

    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a Windows crash after the process started", async () => {
    spawnMock.mockImplementation(gitExit({ code: STATUS_ACCESS_VIOLATION }));

    await expect(runGit(["commit"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failure that produced output", async () => {
    spawnMock.mockImplementation(
      gitExit({ code: 1, stderr: "fatal: bad revision\n" }),
    );

    await expect(runGit(["diff", "bad"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a plain silent nonzero exit", async () => {
    spawnMock.mockImplementation(gitExit({ code: 1 }));

    await expect(runGit(["merge-base"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded attempts and reports the failure", async () => {
    spawnMock.mockImplementation(gitExit({ code: STATUS_DLL_INIT_FAILED }));

    await expect(runGit(["fetch"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it("returns the crash exit code to allowFailure callers only after retrying", async () => {
    spawnMock.mockImplementation(gitExit({ code: STATUS_DLL_INIT_FAILED }));

    const result = await runGit(["show-ref"], {
      cwd: "/repo",
      allowFailure: true,
    });

    expect(result.exitCode).toBe(STATUS_DLL_INIT_FAILED);
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });
});
