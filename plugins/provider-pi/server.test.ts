/**
 * The plugin's registration: the environment it passes through, the skill
 * roots it declares, and the extension state it renders. The per-host roots
 * are the host entry's answer (`src/native-roots.test.ts`); the model
 * settings backend routes every read and write to the selected host.
 */
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import piPlugin from "./server.js";
import { PI_EXTENSION_UI_STATE_NAME } from "./src/extension-state.js";
import type { PiModelSettingsSnapshot } from "./src/model-settings-contract.js";

function registeredDeclaration() {
  const host = createFakePluginHost({ pluginId: "provider-pi" });
  piPlugin(host.bb);
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === "pi",
  );
  if (declaration === undefined) throw new Error("expected pi to be registered");
  return declaration;
}

describe("the pi plugin's environment passthrough", () => {
  it("declares the bridge command override variables so a host-set value reaches the bridge", () => {
    expect(registeredDeclaration().env).toEqual({
      passthrough: ["BB_PI_BRIDGE_COMMAND", "BB_PI_BRIDGE_ARGS"],
    });
  });
});

/** The declared roots as paths: the host normalizes each entry to an object. */
function rootPaths(
  side: readonly (string | { readonly path: string })[] | undefined,
): string[] {
  return (side ?? []).map((root) => (typeof root === "string" ? root : root.path));
}

describe("the pi plugin's skill roots", () => {
  it("declares pi's documented directories and resolves the rest per host", () => {
    const declaration = registeredDeclaration();
    const roots = declaration.experimental_nativeSkillRoots;
    expect(rootPaths(roots?.user)).toEqual([".pi/agent/skills", ".agents/skills"]);
    expect(rootPaths(roots?.project)).toEqual([".pi/skills", ".agents/skills"]);
    expect(declaration.experimental_resolvesNativeRoots).toBe(true);
  });
});

describe("the pi plugin's extension state", () => {
  it("declares the extension-ui state kind the app bundle renders, with no action schema", () => {
    const kinds = registeredDeclaration().extensionKinds;
    expect(kinds?.[PI_EXTENSION_UI_STATE_NAME]?.state).toBeDefined();
    expect(kinds?.[PI_EXTENSION_UI_STATE_NAME]?.item).toBeUndefined();
    expect(kinds?.[PI_EXTENSION_UI_STATE_NAME]?.experimental_action).toBeUndefined();
  });
});

const workstation: PiModelSettingsSnapshot = {
  models: [
    {
      id: "anthropic/claude-sonnet-5",
      displayName: "Claude Sonnet 5",
      provider: "anthropic",
      reasoning: true,
    },
  ],
  enabledModelIds: null,
};
const empty: PiModelSettingsSnapshot = { models: [], enabledModelIds: null };

describe("Pi provider settings backend", () => {
  it("routes reads to the requested host without leaking another host's models", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "provider-pi",
      experimental_callProviderBridgeRpc: ({ hostId }) =>
        hostId === "host-workstation" ? workstation : empty,
    });
    piPlugin(bb);

    await expect(
      harness.behavior.callRpc("readModelSettings", { hostId: "host-empty" }),
    ).resolves.toEqual(empty);
    await expect(
      harness.behavior.callRpc("readModelSettings", { hostId: "host-workstation" }),
    ).resolves.toEqual(workstation);
    expect(
      harness.inspection.experimental_providerBridgeRpcCalls.map(({ providerId, hostId }) => ({
        providerId,
        hostId,
      })),
    ).toEqual([
      { providerId: "pi", hostId: "host-empty" },
      { providerId: "pi", hostId: "host-workstation" },
    ]);
  });

  it("offers natural CLI host targeting without a cwd selector", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "provider-pi",
      sdk: {
        hosts: {
          list: async () => [
            { id: "host-primary", name: "Workstation" },
            { id: "host-laptop", name: "Laptop" },
          ],
        },
        system: {
          config: async () => ({ primaryHostId: "host-primary" }),
        },
      },
      experimental_callProviderBridgeRpc: () => workstation,
    });
    piPlugin(bb);

    const result = await harness.behavior.runCli([
      "models",
      "set",
      "anthropic/claude-sonnet-5",
      "--machine",
      "Laptop",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(workstation);
    expect(harness.inspection.experimental_providerBridgeRpcCalls.at(-1)).toMatchObject({
      providerId: "pi",
      hostId: "host-laptop",
      method: "model-settings/write",
      input: { enabledModelIds: ["anthropic/claude-sonnet-5"] },
    });
  });

  it("writes through the bridge and invalidates provider model caches", async () => {
    const written = { ...workstation, enabledModelIds: ["anthropic/claude-sonnet-5"] };
    const { bb, harness } = createFakePluginHost({
      pluginId: "provider-pi",
      experimental_callProviderBridgeRpc: ({ method }) =>
        method === "model-settings/write" ? written : workstation,
    });
    piPlugin(bb);

    await expect(
      harness.behavior.callRpc("writeModelSettings", {
        hostId: "host-workstation",
        enabledModelIds: ["anthropic/claude-sonnet-5"],
      }),
    ).resolves.toEqual(written);
    expect(harness.inspection.experimental_providerModelChanges).toEqual([
      { providerId: "pi", hostId: "host-workstation" },
    ]);
  });
});
