import { describe, expect, it } from "vitest";
import type {
  PluginProviderDeclaration,
  PluginProviderOptionsContext,
} from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import claudeCodePlugin from "../server.js";

function loadClaudeCodePlugin() {
  const host = createFakePluginHost({ pluginId: "provider-claude-code" });
  claudeCodePlugin(host.bb);
  return host;
}

function getProvider(
  host: ReturnType<typeof loadClaudeCodePlugin>,
  id: string,
): PluginProviderDeclaration {
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === id,
  );
  if (declaration === undefined) {
    throw new Error(`expected ${id} to be registered`);
  }
  return declaration;
}

function providerOptions(
  declaration: PluginProviderDeclaration,
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

describe("the Claude Code provider registrations", () => {
  it("keeps the original provider declaration and derived defaults backward compatible", () => {
    const host = loadClaudeCodePlugin();
    const declaration = getProvider(host, "claude-code");

    expect({
      keys: Object.keys(declaration).sort(),
      id: declaration.id,
      displayName: declaration.displayName,
      icon: declaration.icon,
      visibility: declaration.experimental_visibility,
      strings: declaration.strings,
      maintenance: declaration.maintenance,
      capabilities: declaration.capabilities,
      reasoningLevels: declaration.reasoningLevels,
      composerActions: declaration.composerActions,
      completedTurnDisplay: declaration.completedTurnDisplay,
      env: declaration.env,
      modelIds: declaration.models?.fallback?.map((model) => model.id) ?? [],
      nativeSkillRoots: declaration.experimental_nativeSkillRoots,
      nativeCommandRoots: declaration.experimental_nativeCommandRoots,
      resolvesNativeRoots: declaration.experimental_resolvesNativeRoots,
      hasProviderOptions: declaration.deriveProviderOptions !== undefined,
    }).toMatchInlineSnapshot(`
      {
        "capabilities": {
          "fork": "checkpoint",
          "permissionModes": [
            "accept-edits",
            "auto",
            "full",
          ],
          "reasoningLevels": [
            "low",
            "medium",
            "high",
            "xhigh",
            "ultracode",
            "max",
          ],
          "supportsManualCompaction": true,
          "supportsNativeUserQuestion": true,
          "supportsServiceTier": false,
          "supportsThreadArchive": false,
          "supportsThreadRename": false,
        },
        "completedTurnDisplay": "flat",
        "composerActions": [
          "plan",
        ],
        "displayName": "Claude Code",
        "env": {
          "passthrough": [
            "BB_CLAUDE_CODE_EXECUTABLE",
          ],
        },
        "hasProviderOptions": true,
        "icon": "./icons/claude-code.svg",
        "id": "claude-code",
        "keys": [
          "capabilities",
          "completedTurnDisplay",
          "composerActions",
          "deriveProviderOptions",
          "displayName",
          "env",
          "experimental_nativeCommandRoots",
          "experimental_nativeSkillRoots",
          "experimental_resolvesNativeRoots",
          "experimental_visibility",
          "icon",
          "id",
          "maintenance",
          "models",
          "reasoningLevels",
          "strings",
        ],
        "maintenance": {
          "health": true,
          "installation": true,
          "usage": true,
        },
        "modelIds": [
          "claude-fable-5-1",
          "claude-opus-5[1m]",
          "claude-opus-4-8[1m]",
          "claude-opus-4-7[1m]",
          "claude-sonnet-5",
        ],
        "nativeCommandRoots": {
          "project": [
            {
              "ancestors": false,
              "namePrefix": "",
              "path": ".claude/commands",
              "recursive": false,
            },
          ],
          "user": [],
        },
        "nativeSkillRoots": {
          "project": [
            {
              "ancestors": true,
              "namePrefix": "",
              "path": ".claude/skills",
              "recursive": false,
              "skipIfManifest": ".claude-plugin/plugin.json",
            },
          ],
          "user": [
            {
              "ancestors": false,
              "namePrefix": "",
              "path": ".claude/skills",
              "recursive": false,
              "skipIfManifest": ".claude-plugin/plugin.json",
            },
          ],
        },
        "reasoningLevels": [
          {
            "id": "low",
            "label": "Low",
          },
          {
            "id": "medium",
            "label": "Medium",
          },
          {
            "id": "high",
            "label": "High",
          },
          {
            "id": "xhigh",
            "label": "Extra High",
          },
          {
            "description": "Extra-high effort plus standing workflow orchestration.",
            "id": "ultracode",
            "label": "Ultracode",
          },
          {
            "id": "max",
            "label": "Max",
          },
        ],
        "resolvesNativeRoots": true,
        "strings": {
          "brandPrefix": "Claude ",
          "expiredHint": "Your Claude session expired. Run \`claude\`, then reload.",
          "iconTint": {
            "dark": "#D97757",
            "light": "#D97757",
          },
          "installUrl": "https://claude.com/claude-code",
          "planModeCopy": "Claude Code will plan without normal full-access execution.",
          "signInHint": "Run \`claude\` on the machine to sign in.",
        },
        "visibility": "always",
      }
    `);
    expect(providerOptions(declaration, {})).toMatchInlineSnapshot(`
      {
        "chromeEnabled": false,
        "memoryEnabled": true,
        "providerSubagentsEnabled": true,
        "workflowsEnabled": true,
      }
    `);
  });

  it("registers fixed full, builder, review, and experimental simple variants", () => {
    const host = loadClaudeCodePlugin();
    const registrations = host.harness.registrations.providerRegistrations;

    expect(registrations.map(({ id }) => id)).toEqual([
      "claude-code",
      "claude-code-builder",
      "claude-code-review",
      "claude-code-simple",
    ]);
    expect(
      registrations.map((declaration) => ({
        id: declaration.id,
        options: providerOptions(declaration, {}),
      })),
    ).toMatchObject([
      {
        id: "claude-code",
        options: {},
      },
      {
        id: "claude-code-builder",
        options: { toolProfile: "builder" },
      },
      {
        id: "claude-code-review",
        options: { toolProfile: "review" },
      },
      {
        id: "claude-code-simple",
        options: { simpleSystemPrompt: true },
      },
    ]);
  });
});

describe("the Claude Code provider settings", () => {
  it("keeps Claude in Chrome off by default and derives an explicit opt-in", () => {
    const host = loadClaudeCodePlugin();
    const declaration = getProvider(host, "claude-code");

    expect(
      host.harness.registrations.settingsDescriptors.chromeEnabled,
    ).toMatchObject({ type: "boolean", default: false });
    expect(providerOptions(declaration, {}).chromeEnabled).toBe(false);
    expect(
      providerOptions(declaration, { chromeEnabled: true }).chromeEnabled,
    ).toBe(true);
  });
});
