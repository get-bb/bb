import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { attachServerUpdateControl } from "../src/server-update-control.js";
import { startBbAppProcess } from "../src/bb-process.js";

describe("hosting desktop update control", () => {
  it.each(["direct", ...(process.platform === "linux" ? ["appimage"] : [])])(
    "reports install failure and retries through launcher IPC (%s)",
    async (runtimeKind) => {
      const root = await mkdtemp(join(tmpdir(), "bb-desktop-control-"));
      const bridgePath = join(root, "bridge.mjs");
      const relayUrl = pathToFileURL(
        join(__dirname, "../../../packages/config/src/desktop-app-update.ts"),
      ).href;
      const channelUrl = pathToFileURL(
        join(
          __dirname,
          "../../server/src/services/system/desktop-update-channel.ts",
        ),
      ).href;
      const serverScript = `
        import { createDesktopUpdateChannel } from ${JSON.stringify(channelUrl)};
        import assert from "node:assert/strict";
        const channel = createDesktopUpdateChannel(process);
        const info = await channel.request("status");
        if (info.version !== "1.0.0") process.exit(1);
        await assert.rejects(channel.request("install"), /Installer failed/);
        await channel.request("install");
        process.stdout.write("server update accepted");
        channel.dispose();
        process.disconnect();
      `;
      await writeFile(
        bridgePath,
        `
        import { spawn } from "node:child_process";
        import { relayDesktopAppUpdates } from ${JSON.stringify(relayUrl)};
        const server = spawn(process.execPath, ["--input-type=module", "-e", ${JSON.stringify(serverScript)}], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
        relayDesktopAppUpdates(server);
        server.on("exit", (code) => process.exit(code));
      `,
      );
      const child = startBbAppProcess({
        bridgePath,
        cwd: root,
        env: { ...process.env, APPDIR: root },
        logLineLimit: 50,
        runtime:
          runtimeKind === "appimage"
            ? {
                kind: "appimage",
                appDirPath: root,
                executablePath: process.execPath,
                mode: "electron-node",
              }
            : {
                kind: "direct",
                executablePath: process.execPath,
                mode: "node",
              },
      });
      const install = vi.fn(async () => undefined);
      install.mockRejectedValueOnce(new Error("Installer failed"));
      attachServerUpdateControl({
        child: child.childProcess,
        getInfo: () => ({
          supported: true,
          version: "1.0.0",
          latestVersion: "1.1.0",
          pendingVersion: "1.1.0",
          updateAvailable: true,
          updateDownloaded: true,
          downloadState: "downloaded",
        }),
        check: async () => undefined,
        install,
        subscribe: () => () => undefined,
      });
      try {
        const exit = await child.exit;
        expect(exit, child.logs.text()).toMatchObject({ code: 0 });
        expect(child.logs.text()).toContain("server update accepted");
        expect(install).toHaveBeenCalledTimes(2);
      } finally {
        await child.stop({
          signal: "SIGTERM",
          timeoutMs: 1_000,
          killSignal: "SIGKILL",
          killTimeoutMs: 1_000,
        });
        await rm(root, { recursive: true, force: true });
      }
    },
    10_000,
  );
});
