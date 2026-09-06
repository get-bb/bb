import { describe, expect, it } from "vitest";
import { resolveShellExecOptions } from "../shell-exec.js";

describe("resolveShellExecOptions", () => {
  it("runs commands through a hidden shell on Windows where executables are .cmd shims", () => {
    expect(resolveShellExecOptions({ platform: "win32" })).toEqual({
      shell: true,
      windowsHide: true,
    });
  });

  it.each(["darwin", "linux"] as const)(
    "spawns commands directly on %s",
    (platform) => {
      expect(resolveShellExecOptions({ platform })).toEqual({});
    },
  );

  it("defaults to the current platform", () => {
    expect(resolveShellExecOptions()).toEqual(
      process.platform === "win32"
        ? { shell: true, windowsHide: true }
        : {},
    );
  });
});
