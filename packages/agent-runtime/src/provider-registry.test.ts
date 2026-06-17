import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import {
  createProviderForId,
  listAvailableProviderInfos,
} from "./provider-registry.js";

describe("provider registry", () => {
  it("creates codex provider with expected process config", () => {
    const provider = createProviderForId("codex");
    expect(provider.id).toBe("codex");
    expect(provider.process.command).toBe("codex");
    expect(provider.process.args).toMatchObject(["app-server"]);
  });

  it("creates claude-code provider with expected process config", () => {
    const provider = createProviderForId("claude-code");
    expect(provider.id).toBe("claude-code");
    expect(provider.process.command).toBe("node");
    expect(provider.process.args.slice(0, 3)).toEqual([
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
    ]);
    expect(provider.process.args.at(-1)).toMatch(
      /agent-runtime\/src\/claude-code\/bridge\/bridge\.ts$/,
    );
    expect(existsSync(provider.process.args.at(-1) ?? "")).toBe(true);
  });

  it("passes the configured bridge bundle directory to bundled providers", () => {
    const claudeProvider = createProviderForId("claude-code", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
    });
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      bridgeBundleDir: "/tmp",
    });

    expect(claudeProvider.process.args[0]).toBe(
      "/tmp/bb-claude-code-bridge.mjs",
    );
    expect(piProvider.process.args[0]).toBe("/tmp/bb-pi-bridge.mjs");
  });

  it("passes the configured turn id prefix to bundled providers", () => {
    const claudeProvider = createProviderForId("claude-code", {
      additionalWorkspaceWriteRoots: [],
      turnIdPrefix: "turn_runtime_",
    });
    const piProvider = createProviderForId("pi", {
      additionalWorkspaceWriteRoots: [],
      turnIdPrefix: "turn_runtime_",
    });

    const claudeEvents = claudeProvider.translateEvent({
      type: "assistant",
      message: {},
    });
    const piEvents = piProvider.translateEvent({
      type: "agent_start",
    });

    expect(claudeEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn_runtime_1"),
      }),
    );
    expect(piEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn_runtime_1"),
      }),
    );
  });

  it("creates pi provider with expected process config", () => {
    const provider = createProviderForId("pi");
    expect(provider.id).toBe("pi");
    expect(provider.process.command).toBe("node");
    expect(provider.process.args.slice(0, 3)).toEqual([
      "--conditions=source",
      "--import",
      import.meta.resolve("tsx"),
    ]);
    expect(provider.process.args.at(-1)).toMatch(
      /agent-runtime\/src\/pi\/bridge\/bridge\.ts$/,
    );
    expect(existsSync(provider.process.args.at(-1) ?? "")).toBe(true);
  });

  it("rejects unsupported adapters", () => {
    expect(() => createProviderForId("pi-mono")).toThrow(
      'Unsupported provider "pi-mono"',
    );
  });

  it("lists provider catalog", () => {
    expect(listAvailableProviderInfos()).toMatchObject([
      {
        id: "codex",
        displayName: "Codex",
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: true,
          supportsUserQuestion: false,
          supportsFork: true,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        available: true,
      },
      {
        id: "claude-code",
        displayName: "Claude Code",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: true,
          supportsFork: true,
          supportedPermissionModes: ["full", "workspace-write", "readonly"],
        },
        available: true,
      },
      {
        id: "pi",
        displayName: "Pi",
        capabilities: {
          supportsArchive: false,
          supportsRename: false,
          supportsServiceTier: false,
          supportsUserQuestion: false,
          supportsFork: true,
          supportedPermissionModes: ["full"],
        },
        available: true,
      },
    ]);
  });
});
