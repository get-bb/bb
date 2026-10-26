import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeLoginCommand,
  getClaudeProviderHealth,
  getClaudeProviderInstallationStatus,
} from "./provider-maintenance.js";

const FAKE_CLAUDE_SCRIPT = '#!/bin/sh\necho "2.1.274 (Claude Code)"\n';

async function writeFakeClaude(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const executable = path.join(directory, "claude");
  await writeFile(executable, FAKE_CLAUDE_SCRIPT);
  await chmod(executable, 0o755);
  return executable;
}

describe.skipIf(process.platform === "win32")(
  "Claude Code native install outside PATH",
  () => {
    let root: string;
    let home: string;

    beforeEach(async () => {
      root = await mkdtemp(path.join(os.tmpdir(), "bb-claude-native-"));
      home = path.join(root, "home");
      await mkdir(home, { recursive: true });
      vi.stubEnv("HOME", home);
      vi.stubEnv("PATH", "/usr/bin:/bin");
      vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", "");
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    });

    it("reports the native installer's ~/.local/bin/claude as installed", async () => {
      const nativeClaude = await writeFakeClaude(
        path.join(home, ".local", "bin"),
      );

      const status = await getClaudeProviderInstallationStatus(false);

      expect(status).toMatchObject({
        installed: true,
        executableName: nativeClaude,
        executablePath: nativeClaude,
        currentVersion: "2.1.274",
        installAction: null,
      });
    });

    it("keeps health installed and signs in through the resolved path", async () => {
      const nativeClaude = await writeFakeClaude(
        path.join(home, ".local", "bin"),
      );

      const result = await getClaudeProviderHealth();

      expect(result.supported).toBe(true);
      if (!result.supported) return;
      expect(result.health.status).not.toBe("not_installed");
      expect(result.health.installedVersion).toBe("2.1.274");
      expect(result.health.loginCommand).toBe(`${nativeClaude} auth login`);
    });

    it("keeps the bare command when claude is on PATH", async () => {
      await writeFakeClaude(path.join(home, ".local", "bin"));
      const pathBin = path.join(root, "path-bin");
      const pathClaude = await writeFakeClaude(pathBin);
      vi.stubEnv("PATH", `${pathBin}:/usr/bin:/bin`);

      const [status, health] = await Promise.all([
        getClaudeProviderInstallationStatus(false),
        getClaudeProviderHealth(),
      ]);

      expect(status).toMatchObject({
        installed: true,
        executableName: "claude",
        executablePath: pathClaude,
      });
      expect(health.supported && health.health.loginCommand).toBe(
        "claude auth login",
      );
    });
  },
);

describe("claudeLoginCommand", () => {
  it.each([
    [
      "win32",
      "C:\\Users\\dev\\.local\\bin\\claude.exe",
      "& 'C:\\Users\\dev\\.local\\bin\\claude.exe' auth login",
    ],
    ["win32", "claude", "claude auth login"],
    [
      "darwin",
      "/Users/dev/.local/bin/claude",
      "/Users/dev/.local/bin/claude auth login",
    ],
    ["linux", "claude", "claude auth login"],
  ] as const)("formats %s %s", (platform, command, expected) => {
    expect(claudeLoginCommand(command, ["auth", "login"], platform)).toBe(
      expected,
    );
  });
});
