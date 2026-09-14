import { describe, expect, it } from "vitest";
import {
  argsFormError,
  cwdFormError,
  defaultProcessNameForExe,
  exePathFormError,
  hostExecutableFormError,
  nameFormError,
  normalizeProcessName,
  processNameFormError,
} from "./limits.js";

describe("profile field validation", () => {
  it("accepts a valid profile shape", () => {
    expect(exePathFormError("C:\\Program Files\\App\\app.exe")).toBeNull();
    expect(cwdFormError("C:\\Program Files\\App")).toBeNull();
    expect(argsFormError(["--port", "8080"])).toBeNull();
    expect(processNameFormError("app")).toBeNull();
    expect(nameFormError("  Render server ")).toBeNull();
  });

  it("rejects relative and overlong paths", () => {
    expect(exePathFormError("app.exe")).toMatch(/absolute/u);
    expect(exePathFormError("")).toMatch(/required/u);
    expect(exePathFormError(`C:\\${"x".repeat(700)}.exe`)).toMatch(
      /at most 600/u,
    );
    expect(cwdFormError("relative/dir")).toMatch(/absolute/u);
  });

  it("rejects control characters in every field", () => {
    expect(exePathFormError("C:\\app\x01.exe")).toMatch(/control/u);
    expect(cwdFormError("C:\\dir\x7f")).toMatch(/control/u);
    expect(argsFormError(["--ok", "bad\x00arg"])).toMatch(/control/u);
  });

  it("rejects empty or too many args", () => {
    expect(argsFormError([""])).toMatch(/empty/u);
    expect(argsFormError(Array.from({ length: 33 }, () => "-x"))).toMatch(
      /at most 32/u,
    );
  });

  it("rejects process names with separators", () => {
    expect(processNameFormError("dir/app")).toMatch(/separators/u);
    expect(processNameFormError("..\\app")).toMatch(/separators/u);
  });

  it("requires a non-empty trimmed name", () => {
    expect(nameFormError("   ")).toMatch(/required/u);
    expect(nameFormError("x".repeat(65))).toMatch(/at most 64/u);
  });

  it("requires .exe on win32 but not elsewhere", () => {
    expect(hostExecutableFormError("C:\\app\\app.bat", "win32")).toMatch(
      /\.exe/u,
    );
    expect(hostExecutableFormError("C:\\app\\app.exe", "win32")).toBeNull();
    expect(hostExecutableFormError("/usr/bin/python3", "linux")).toBeNull();
  });

  it("derives and normalizes process names", () => {
    expect(defaultProcessNameForExe("C:\\Apps\\Tool.exe")).toBe("Tool");
    expect(normalizeProcessName("Tool.EXE")).toBe("tool");
    expect(normalizeProcessName("Tool")).toBe("tool");
  });
});
