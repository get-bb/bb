import { describe, expect, it } from "vitest";
import { resolveHostPlatform } from "./host-platform.js";

describe("resolveHostPlatform", () => {
  it("maps win32 to win32", () => {
    expect(resolveHostPlatform("win32", {})).toBe("win32");
  });

  it("maps linux without WSL to linux", () => {
    expect(resolveHostPlatform("linux", {})).toBe("linux");
  });

  it("maps linux with WSL env to wsl", () => {
    expect(resolveHostPlatform("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(
      "wsl",
    );
  });
});
