import { describe, expect, it } from "vitest";
import type { PluginProviderOptionsContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import claudeCodePlugin from "../server.js";

function loadClaudeCodePlugin() {
  const host = createFakePluginHost({ pluginId: "provider-claude-code" });
  claudeCodePlugin(host.bb);
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === "claude-code",
  );
  if (declaration === undefined) {
    throw new Error("expected Claude Code to be registered");
  }
  return { declaration, host };
}

function providerOptions(
  declaration: ReturnType<typeof loadClaudeCodePlugin>["declaration"],
  settings: PluginProviderOptionsContext["settings"],
) {
  const deriveProviderOptions = declaration.deriveProviderOptions;
  if (deriveProviderOptions === undefined) {
    throw new Error("expected Claude Code provider options");
  }
  return deriveProviderOptions({
    threadId: "thread-1",
    projectId: "project-1",
    model: "claude-sonnet-5",
    permissionMode: "accept-edits",
    settings,
  });
}

describe("the Claude Code provider settings", () => {
  it.each(["chromeEnabled", "disable1MContext"])(
    "keeps %s off by default and derives an explicit opt-in",
    (key) => {
      const { declaration, host } = loadClaudeCodePlugin();

      expect(host.harness.registrations.settingsDescriptors[key]).toMatchObject(
        { type: "boolean", default: false },
      );
      expect(providerOptions(declaration, {})[key]).toBe(false);
      expect(providerOptions(declaration, { [key]: true })[key]).toBe(true);
    },
  );
});
