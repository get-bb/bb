import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tags: "",
  executablePath: "/test/.local/bin/claude",
  npmBin: null as string | null,
  compatibilityOnly: false,
  commands: [] as string[][],
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@get-bb/plugin-sdk/provider-bridge")
  >()),
  experimental_resolveExecutablePath: async () => state.executablePath,
  experimental_probeNpmGlobalPackage: async () => {
    if (state.compatibilityOnly)
      throw new Error("Update discovery ran during compatibility validation");
    return { npmBin: state.npmBin, npmGlobalPackageVersion: null };
  },
  experimental_commandOutput: async (_command: string, args: string[]) => {
    state.commands.push(args);
    if (state.compatibilityOnly && args[0] !== "--version")
      throw new Error("Update discovery ran during compatibility validation");
    if (args[0] === "view") return state.tags;
    if (args[0] === "--version") return "2.1.274 (Claude Code)";
    throw new Error(`Unexpected command arguments: ${args.join(" ")}`);
  },
}));

import { getClaudeProviderInstallationStatus } from "./provider-maintenance.js";

const tags = { stable: "2.1.280", latest: "2.1.283", next: "2.1.283" };

describe("Claude Code installation status", () => {
  beforeEach(() => {
    state.tags = JSON.stringify(tags);
    state.executablePath = "/test/.local/bin/claude";
    state.npmBin = null;
    state.compatibilityOnly = false;
    state.commands = [];
  });

  it("checks the local installation without npm or doctor probes", async () => {
    state.compatibilityOnly = true;
    const status = await getClaudeProviderInstallationStatus(false);
    expect(status).toMatchObject({
      installed: true,
      currentVersion: "2.1.274",
      versionUnsupported: false,
      latestVersion: null,
    });
    expect(state.commands).toEqual([["--version"]]);
  });

  it("checks for updates without running an auth-capable Claude subcommand", async () => {
    await getClaudeProviderInstallationStatus();
    expect(state.commands).toEqual([
      ["--version"],
      ["view", "@anthropic-ai/claude-code", "dist-tags", "--json"],
    ]);
  });

  it.each([
    ["npm 11", JSON.stringify(tags), null, true],
    ["npm 12", JSON.stringify([tags]), null, true],
    [
      "stable is current",
      '{"latest":"2.1.283","stable":"2.1.274"}',
      null,
      false,
    ],
    [
      "channels agree",
      '{"latest":"2.1.283","stable":"2.1.283"}',
      "2.1.283",
      true,
    ],
    ["npm 12 without stable", '[{"latest":"2.1.283"}]', "2.1.283", true],
  ])(
    "reads %s dist-tags without guessing the configured channel",
    async (_npm, output, latestVersion, needsUpdate) => {
      state.tags = output;
      const status = await getClaudeProviderInstallationStatus();
      expect(status.latestVersion).toBe(latestVersion);
      expect(status.needsUpdate).toBe(needsUpdate);
      expect(status.installAction?.kind ?? null).toBe(
        needsUpdate ? "update" : null,
      );
    },
  );

  it("offers an update for an identified global npm installation", async () => {
    state.executablePath = "/test/npm/bin/claude";
    state.npmBin = "/test/npm/bin";
    expect(await getClaudeProviderInstallationStatus()).toMatchObject({
      installSource: "npmGlobal",
      needsUpdate: true,
      installAction: { kind: "update" },
    });
  });

  it("leaves updates for unrecognized external installations to their installer", async () => {
    state.executablePath = "/opt/homebrew/bin/claude";
    expect(await getClaudeProviderInstallationStatus()).toMatchObject({
      installSource: "external",
      needsUpdate: true,
      installAction: null,
    });
  });

  it.each([
    ["multiple packages", JSON.stringify([tags, tags])],
    ["empty array", "[]"],
    ["invalid JSON", "{"],
    ["missing latest", '[{"stable":"2.1.274"}]'],
  ])("reports an unknown version for %s", async (_name, output) => {
    state.tags = output;
    const status = await getClaudeProviderInstallationStatus();
    expect(status.latestVersion).toBeNull();
    expect(status.needsUpdate).toBe(false);
    expect(status.installAction).toBeNull();
  });
});
