import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesktopReleaseConfig } from "../scripts/desktop-release-channel.mjs";
import { createDesktopReleaseInfo } from "../src/desktop-update-provider.js";
import {
  createWindowsInstallerMutexName,
  waitForWindowsInstaller,
} from "../src/windows-installer.js";

interface BuilderUtilRuntime {
  UUID: {
    parse(uuid: string): Buffer;
    v5(name: string, namespace: Buffer): string;
  };
}

function loadElectronBuilderUuid() {
  const requireFromBuilder = createRequire(
    createRequire(resolve(process.cwd(), "package.json")).resolve(
      "electron-builder/package.json",
    ),
  );
  const { UUID }: BuilderUtilRuntime = requireFromBuilder(
    "builder-util-runtime",
  );
  return (appId: string) =>
    UUID.v5(appId, UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"));
}

function nodeCommand(script: string) {
  return { args: ["-e", script], executablePath: process.execPath };
}

describe("Windows installer mutex name", () => {
  it.each(["latest", "nightly"] as const)(
    "matches the APP_GUID electron-builder gives the %s NSIS installer",
    (channel) => {
      const electronBuilderGuid = loadElectronBuilderUuid();
      const releaseInfo = createDesktopReleaseInfo(channel);

      expect(releaseInfo.appId).toBe(createDesktopReleaseConfig(channel).appId);
      expect(createWindowsInstallerMutexName(releaseInfo.appId)).toBe(
        electronBuilderGuid(releaseInfo.appId),
      );
    },
  );
});

describe("waitForWindowsInstaller", () => {
  it("reports a running installer before waiting for it to finish", async () => {
    let waited = false;

    const result = await waitForWindowsInstaller({
      command: nodeCommand(
        "console.log('waiting'); setTimeout(() => console.log('finished'), 200);",
      ),
      onWaiting: () => {
        waited = true;
      },
      timeoutMs: 5_000,
    });

    expect(result).toBe("finished");
    expect(waited).toBe(true);
  });

  it("does not wait when no installer is running", async () => {
    let waited = false;

    const result = await waitForWindowsInstaller({
      command: nodeCommand("console.log('not-running');"),
      onWaiting: () => {
        waited = true;
      },
      timeoutMs: 5_000,
    });

    expect(result).toBe("not-running");
    expect(waited).toBe(false);
  });

  it("treats a check that cannot run as unknown", async () => {
    const result = await waitForWindowsInstaller({
      command: { args: [], executablePath: "/nonexistent/powershell.exe" },
      onWaiting: () => {},
      timeoutMs: 5_000,
    });

    expect(result).toBe("unknown");
  });
});
