import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClaudeProviderInstallationStatus } from "./provider-maintenance.js";

describe.skipIf(process.platform === "win32")(
  "Claude native installation discovery",
  () => {
    let home: string;
    let bin: string;
    let nativePath: string;

    beforeEach(async () => {
      const which = execFileSync("which", ["which"], {
        encoding: "utf8",
      }).trim();
      home = await mkdtemp(path.join(os.tmpdir(), "bb-claude-discovery-"));
      bin = path.join(home, "path-bin");
      nativePath = path.join(home, ".local", "bin", "claude");
      await mkdir(bin);
      await symlink(which, path.join(bin, "which"));
      vi.spyOn(os, "homedir").mockReturnValue(home);
      vi.stubEnv("HOME", home);
      vi.stubEnv("PATH", bin);
      vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", undefined);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(home, { recursive: true, force: true });
    });

    async function installFixture(executable: string, version = "2.1.289") {
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(
        executable,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf '%s\\n' '${version} (Claude Code)'\nelse\n  printf '%s\\n' 'Your organization requires remote managed settings to load, but they could not be loaded.' >&2\n  exit 1\nfi\n`,
        { mode: 0o755 },
      );
    }

    it("finds a native install outside PATH even when doctor cannot load managed settings", async () => {
      await installFixture(nativePath);

      const status = await getClaudeProviderInstallationStatus();

      expect(status).toMatchObject({
        executablePath: nativePath,
        installed: true,
        currentVersion: "2.1.289",
        installAction: null,
        versionUnsupported: false,
      });
    });

    it("discovers a newly installed native symlink on the next check", async () => {
      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        installed: false,
        installAction: { kind: "install" },
      });
      const versionPath = path.join(
        home,
        ".local",
        "share",
        "claude",
        "versions",
        "2.1.289",
      );
      await installFixture(versionPath);
      await mkdir(path.dirname(nativePath), { recursive: true });
      await symlink(versionPath, nativePath);

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        executablePath: nativePath,
        installed: true,
        currentVersion: "2.1.289",
        installAction: null,
      });
    });

    it("prefers the executable on PATH over the native install", async () => {
      await installFixture(nativePath);
      const pathExecutable = path.join(bin, "claude");
      await installFixture(pathExecutable, "2.1.290");

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        executablePath: pathExecutable,
        currentVersion: "2.1.290",
      });
    });

    it("preserves PATH precedence when which is unavailable", async () => {
      await rm(path.join(bin, "which"));
      await installFixture(nativePath);
      const pathExecutable = path.join(bin, "claude");
      await installFixture(pathExecutable, "2.1.290");

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        executablePath: pathExecutable,
        currentVersion: "2.1.290",
      });
    });

    it("preserves explicit executable overrides", async () => {
      await installFixture(nativePath);
      await installFixture(path.join(bin, "claude"));
      const explicit = path.join(home, "custom", "claude");
      await installFixture(explicit, "2.1.291");
      vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", `  ${explicit}  `);

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        executablePath: explicit,
        currentVersion: "2.1.291",
      });
    });

    it("does not replace an invalid explicit override with the native install", async () => {
      await installFixture(nativePath);
      vi.stubEnv("BB_CLAUDE_CODE_EXECUTABLE", path.join(home, "missing"));

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        installed: false,
        executablePath: null,
      });
    });

    it("does not report a non-executable native file as installed", async () => {
      await installFixture(nativePath);
      await chmod(nativePath, 0o644);

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        installed: false,
        executablePath: null,
      });
    });

    it("does not report a directory at the native path as installed", async () => {
      await mkdir(nativePath, { recursive: true });

      expect(await getClaudeProviderInstallationStatus(false)).toMatchObject({
        installed: false,
        executablePath: null,
      });
    });
  },
);
