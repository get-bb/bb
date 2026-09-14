import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  escalateWindowsShellChildKill,
  piLaunchRequiresWindowsShell,
  planPiChildKill,
} from "./rpc-child.windows.js";

describe("piLaunchRequiresWindowsShell", () => {
  it("requires the Windows shell for an extensionless command on win32", () => {
    expect(piLaunchRequiresWindowsShell("pi", "win32")).toBe(true);
    expect(piLaunchRequiresWindowsShell("C:\\Tools\\pi", "win32")).toBe(true);
  });

  it("requires the Windows shell for npm and batch shims on win32", () => {
    expect(piLaunchRequiresWindowsShell("pi.cmd", "win32")).toBe(true);
    expect(piLaunchRequiresWindowsShell("C:\\Tools\\pi.bat", "win32")).toBe(
      true,
    );
  });

  it("spawns an .exe directly on win32", () => {
    expect(piLaunchRequiresWindowsShell("pi.exe", "win32")).toBe(false);
    expect(piLaunchRequiresWindowsShell("C:\\Tools\\pi.exe", "win32")).toBe(
      false,
    );
  });

  it("never needs the Windows shell on POSIX", () => {
    for (const command of ["pi", "pi.cmd", "pi.exe"]) {
      expect(piLaunchRequiresWindowsShell(command, "darwin")).toBe(false);
      expect(piLaunchRequiresWindowsShell(command, "linux")).toBe(false);
    }
  });
});

describe("planPiChildKill", () => {
  it("escalates immediately without a signal for a Windows shell child", () => {
    expect(
      planPiChildKill({ windowsShellChild: true, platform: "win32" }),
    ).toEqual({ signal: null, escalateImmediately: true });
  });

  it("keeps SIGTERM with delayed escalation on POSIX", () => {
    expect(
      planPiChildKill({ windowsShellChild: false, platform: "linux" }),
    ).toEqual({ signal: "SIGTERM", escalateImmediately: false });
  });

  it("never sends SIGTERM to a direct child on win32", () => {
    expect(
      planPiChildKill({ windowsShellChild: false, platform: "win32" }),
    ).toEqual({ signal: null, escalateImmediately: false });
  });
});

describe("escalateWindowsShellChildKill", () => {
  it("runs taskkill against the process tree", () => {
    const taskkill = new EventEmitter();
    const spawnProcess = vi.fn(() => taskkill);
    const killFallback = vi.fn();

    escalateWindowsShellChildKill({
      pid: 1234,
      killFallback,
      spawnProcess,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "1234", "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    expect(killFallback).not.toHaveBeenCalled();
  });

  it("falls back to SIGKILL when taskkill cannot start", () => {
    const taskkill = new EventEmitter();
    const killFallback = vi.fn();

    escalateWindowsShellChildKill({
      pid: 1234,
      killFallback,
      spawnProcess: () => taskkill,
    });
    taskkill.emit("error", new Error("ENOENT"));

    expect(killFallback).toHaveBeenCalledWith("SIGKILL");
  });

  it("falls back to SIGKILL when spawning taskkill throws", () => {
    const killFallback = vi.fn();

    escalateWindowsShellChildKill({
      pid: 1234,
      killFallback,
      spawnProcess: () => {
        throw new Error("boom");
      },
    });

    expect(killFallback).toHaveBeenCalledWith("SIGKILL");
  });

  it("does nothing without a pid", () => {
    const spawnProcess = vi.fn();

    escalateWindowsShellChildKill({
      pid: undefined,
      killFallback: vi.fn(),
      spawnProcess,
    });

    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
