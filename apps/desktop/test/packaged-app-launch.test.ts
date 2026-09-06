import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPackagedAppLaunchArguments } from "../scripts/packaged-app-launch.mjs";
import { resolvePackagedAppBinary } from "../scripts/packaged-app-paths.mjs";

describe("createPackagedAppLaunchArguments", () => {
  it("disables the Chromium sandbox on Linux", () => {
    expect(
      createPackagedAppLaunchArguments({
        platform: "linux",
        userDataDir: "/tmp/smoke/user-data",
      }),
    ).toEqual(["--no-sandbox", "--user-data-dir=/tmp/smoke/user-data"]);
  });

  it("keeps the Chromium sandbox on Windows", () => {
    expect(
      createPackagedAppLaunchArguments({
        platform: "win32",
        userDataDir: "C:\\Users\\bb\\AppData\\Roaming\\bb wn",
      }),
    ).toEqual([
      "--user-data-dir=C:\\Users\\bb\\AppData\\Roaming\\bb wn",
    ]);
  });
});

describe("resolvePackagedAppBinary", () => {
  it("resolves the Windows executable from win-unpacked", async () => {
    await expect(
      resolvePackagedAppBinary({
        executableName: "bb",
        platform: "win32",
        productName: "bb wn",
        releaseDir: "/tmp/bb-release",
      }),
    ).resolves.toBe(join("/tmp/bb-release", "win-unpacked", "bb wn.exe"));
  });

  it("resolves the Windows nightly executable without clashing with stable", async () => {
    await expect(
      resolvePackagedAppBinary({
        executableName: "bb-nightly",
        platform: "win32",
        productName: "bb wn Nightly",
        releaseDir: "/tmp/bb-release",
      }),
    ).resolves.toBe(
      join("/tmp/bb-release", "win-unpacked", "bb wn Nightly.exe"),
    );
  });

  it("resolves the Linux executable from linux-unpacked", async () => {
    await expect(
      resolvePackagedAppBinary({
        executableName: "bb",
        platform: "linux",
        productName: "bb",
        releaseDir: "/tmp/bb-release",
      }),
    ).resolves.toBe(join("/tmp/bb-release", "linux-unpacked", "bb"));
  });

  it("rejects unsupported platforms", async () => {
    await expect(
      resolvePackagedAppBinary({
        executableName: "bb",
        platform: "freebsd",
        productName: "bb",
        releaseDir: "/tmp/bb-release",
      }),
    ).rejects.toThrow("Unsupported packaged desktop platform: freebsd");
  });
});
