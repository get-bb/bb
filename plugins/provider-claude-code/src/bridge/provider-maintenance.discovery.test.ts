import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClaudeProviderInstallationStatus } from "./provider-maintenance.js";

describe.skipIf(process.platform === "win32")(
  "Claude Code installation status",
  () => {
    let homeDir: string;
    let pathDir: string;

    beforeEach(async () => {
      homeDir = await mkdtemp(path.join(os.tmpdir(), "claude-discovery-"));
      pathDir = path.join(homeDir, "path");
      await mkdir(pathDir);
      vi.stubEnv("HOME", homeDir);
      vi.stubEnv("PATH", pathDir);
      vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", "");
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await rm(homeDir, { recursive: true, force: true });
    });

    it.each([
      { name: "a native install outside PATH", onPath: false },
      { name: "the PATH executable over the native install", onPath: true },
    ])("reports $name as installed", async ({ onPath }) => {
      const nativePath = path.join(homeDir, ".local", "bin", "claude");
      const pathExecutable = path.join(pathDir, "claude");
      const executable = `#!${process.execPath}\nprocess.stdout.write("2.1.310 (Claude Code)\\n");\n`;
      await mkdir(path.dirname(nativePath), { recursive: true });
      await writeFile(nativePath, executable, { mode: 0o755 });
      if (onPath) await writeFile(pathExecutable, executable, { mode: 0o755 });

      const status = await getClaudeProviderInstallationStatus(false);

      expect(status).toMatchObject({
        installed: true,
        executablePath: onPath ? pathExecutable : nativePath,
        currentVersion: "2.1.310",
      });
      expect(status.installAction).toBeNull();
    });
  },
);
