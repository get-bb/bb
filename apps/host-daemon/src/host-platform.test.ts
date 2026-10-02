import { describe, expect, it } from "vitest";
import { resolveHostPlatform } from "./host-platform.js";

describe("resolveHostPlatform", () => {
  it("reports each supported operating system", () => {
    expect(resolveHostPlatform("darwin", {})).toBe("darwin");
    expect(resolveHostPlatform("linux", {})).toBe("linux");
    expect(resolveHostPlatform("win32", {})).toBe("win32");
  });

  it("reports WSL for Linux inside Windows Subsystem for Linux", () => {
    expect(resolveHostPlatform("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(
      "wsl",
    );
    expect(resolveHostPlatform("linux", { WSL_INTEROP: "/run/WSL/1" })).toBe(
      "wsl",
    );
  });

  it("reports unknown for other operating systems", () => {
    expect(resolveHostPlatform("freebsd", {})).toBe("unknown");
  });
});
