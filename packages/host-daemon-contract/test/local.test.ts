import { describe, expect, it } from "vitest";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  PATHS_EXIST_MAX_PATHS,
  hostPlatformSchema,
  pathsExistRequestSchema,
  pathsExistResponseSchema,
  providerCliInstallEventSchema,
  providerCliInstallRequestSchema,
  providerCliStatusResponseSchema,
  statusResponseSchema,
} from "../src/index.js";

describe("hostPlatformSchema", () => {
  it("accepts the supported platform values", () => {
    for (const value of ["darwin", "linux", "wsl", "unknown"] as const) {
      expect(hostPlatformSchema.parse(value)).toBe(value);
    }
  });

  it("rejects other strings", () => {
    expect(() => hostPlatformSchema.parse("win32")).toThrow();
    expect(() => hostPlatformSchema.parse("")).toThrow();
  });
});

describe("statusResponseSchema", () => {
  it("requires platform", () => {
    expect(() =>
      statusResponseSchema.parse({
        hostId: "host_1",
        connected: true,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
      }),
    ).toThrow();
  });

  it("accepts a fully formed status", () => {
    expect(
      statusResponseSchema.parse({
        hostId: "host_1",
        connected: true,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: true,
        platform: "darwin",
      }),
    ).toMatchObject({ platform: "darwin" });
  });
});

describe("pathsExistRequestSchema", () => {
  it("dedupes repeated paths", () => {
    const result = pathsExistRequestSchema.parse({
      paths: ["/a", "/a", "/b"],
    });
    expect(result.paths).toEqual(["/a", "/b"]);
  });

  it("rejects empty path arrays", () => {
    expect(() => pathsExistRequestSchema.parse({ paths: [] })).toThrow();
  });

  it("rejects empty-string path entries", () => {
    expect(() => pathsExistRequestSchema.parse({ paths: [""] })).toThrow();
  });

  it("rejects oversized batches", () => {
    const oversized = Array.from(
      { length: PATHS_EXIST_MAX_PATHS + 1 },
      (_, i) => `/p${i}`,
    );
    expect(() => pathsExistRequestSchema.parse({ paths: oversized })).toThrow();
  });
});

describe("pathsExistResponseSchema", () => {
  it("requires existence to be a boolean record", () => {
    expect(
      pathsExistResponseSchema.parse({
        existence: { "/a": true, "/b": false },
      }),
    ).toEqual({ existence: { "/a": true, "/b": false } });
  });

  it("rejects non-boolean values", () => {
    expect(() =>
      pathsExistResponseSchema.parse({ existence: { "/a": "yes" } }),
    ).toThrow();
  });
});

describe("provider CLI schemas", () => {
  it("accepts status for Codex and Claude Code", () => {
    expect(
      providerCliStatusResponseSchema.parse({
        codex: {
          displayName: "Codex",
          executableName: "codex",
          executablePath: null,
          installed: false,
          installSource: "notInstalled",
          currentVersion: null,
          latestVersion: "0.133.0",
          npmPackageName: "@openai/codex",
          npmGlobalPackageVersion: null,
          installAction: {
            kind: "install",
            label: "Install",
            commandKind: "exec",
            command: "npm install -g @openai/codex@latest",
          },
          needsUpdate: false,
        },
        claudeCode: {
          displayName: "Claude Code",
          executableName: "claude",
          executablePath: "/opt/homebrew/bin/claude",
          installed: true,
          installSource: "npmGlobal",
          currentVersion: "2.1.147",
          latestVersion: "2.1.148",
          npmPackageName: "@anthropic-ai/claude-code",
          npmGlobalPackageVersion: "2.1.147",
          installAction: {
            kind: "update",
            label: "Update",
            commandKind: "exec",
            command: "claude update",
          },
          needsUpdate: true,
        },
      }).claudeCode.needsUpdate,
    ).toBe(true);

    expect(
      providerCliStatusResponseSchema.parse({
        codex: {
          displayName: "Codex",
          executableName: "codex",
          executablePath: "/usr/local/bin/codex",
          installed: true,
          installSource: "npmGlobal",
          currentVersion: "0.133.0",
          latestVersion: "0.133.0",
          npmPackageName: "@openai/codex",
          npmGlobalPackageVersion: "0.133.0",
          installAction: null,
          needsUpdate: false,
        },
        claudeCode: {
          displayName: "Claude Code",
          executableName: "claude",
          executablePath: null,
          installed: false,
          installSource: "notInstalled",
          currentVersion: null,
          latestVersion: "2.1.148",
          npmPackageName: "@anthropic-ai/claude-code",
          npmGlobalPackageVersion: null,
          installAction: {
            kind: "install",
            label: "Install",
            commandKind: "shell",
            command: "curl -fsSL https://claude.ai/install.sh | bash",
          },
          needsUpdate: false,
        },
      }).claudeCode.installAction,
    ).toMatchObject({ commandKind: "shell" });
  });

  it("accepts install requests and streamed install events", () => {
    expect(
      providerCliInstallRequestSchema.parse({
        provider: "codex",
        actionKind: "update",
      }),
    ).toEqual({ provider: "codex", actionKind: "update" });
    expect(
      providerCliInstallEventSchema.parse({
        type: "output",
        provider: "claudeCode",
        stream: "stderr",
        text: "installing\n",
      }),
    ).toMatchObject({ type: "output", stream: "stderr" });
  });
});
