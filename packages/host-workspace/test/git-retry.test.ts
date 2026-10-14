import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit, WorkspaceError } from "../src/git.js";

const execPortableFileMock = vi.hoisted(() => vi.fn());

vi.mock("@bb/process-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/process-utils")>();
  return { ...actual, execPortableFile: execPortableFileMock };
});

const STATUS_DLL_INIT_FAILED = 0xc0000142;
const STATUS_ACCESS_VIOLATION = 0xc0000005;

function processFailure(
  overrides: Partial<{
    code: number | string;
    signal: string | null;
    killed: boolean;
    stdout: string;
    stderr: string;
  }> = {},
): Error {
  return Object.assign(new Error("Command failed: git"), {
    code: 1,
    signal: null,
    killed: false,
    stdout: "",
    stderr: "",
    ...overrides,
  });
}

afterEach(() => {
  execPortableFileMock.mockReset();
});

describe("runGit Windows startup crash retries", () => {
  it("retries a silent Windows process startup crash", async () => {
    execPortableFileMock
      .mockRejectedValueOnce(processFailure({ code: STATUS_DLL_INIT_FAILED }))
      .mockResolvedValueOnce({ stdout: "ok\n", stderr: "" });

    const result = await runGit(["status"], { cwd: "/repo" });

    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    expect(execPortableFileMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a Windows crash after the process started", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ code: STATUS_ACCESS_VIOLATION }),
    );

    await expect(runGit(["commit"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failure that produced output", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ stderr: "fatal: bad revision\n" }),
    );

    await expect(runGit(["diff", "bad"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a plain silent nonzero exit", async () => {
    execPortableFileMock.mockRejectedValue(processFailure());

    await expect(runGit(["merge-base"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded attempts and reports the failure", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ code: STATUS_DLL_INIT_FAILED }),
    );

    await expect(runGit(["fetch"], { cwd: "/repo" })).rejects.toThrow(
      WorkspaceError,
    );
    expect(execPortableFileMock).toHaveBeenCalledTimes(3);
  });

  it("returns the crash exit code to allowFailure callers only after retrying", async () => {
    execPortableFileMock.mockRejectedValue(
      processFailure({ code: STATUS_DLL_INIT_FAILED }),
    );

    const result = await runGit(["show-ref"], {
      cwd: "/repo",
      allowFailure: true,
    });

    expect(result.exitCode).toBe(STATUS_DLL_INIT_FAILED);
    expect(execPortableFileMock).toHaveBeenCalledTimes(3);
  });
});
