import { describe, expect, it } from "vitest";
import { piLaunchRequiresWindowsShell } from "./rpc-child.js";

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
