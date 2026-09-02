import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import rappPlugin from "./server.js";
import {
  RAPP_BRAINSTEM_SECRET_ENV,
  RAPP_BRAINSTEM_URL_ENV,
  RAPP_BUSINESS_MODEL_ID,
  RAPP_BUSINESS_URL_ENV,
  RAPP_FUNCTION_KEY_ENV,
  RAPP_MODEL_ID,
  RAPP_PROVIDER_ID,
  RAPP_USER_GUID_ENV,
} from "./src/vocabulary.js";

async function registration(
  settings: { grail: "consumer" | "business"; endpoint: string } = {
    grail: "consumer",
    endpoint: "",
  },
) {
  const host = createFakePluginHost({
    pluginId: "provider-rapp",
    settings,
  });
  await rappPlugin(host.bb);
  const declaration = host.harness.registrations.providerRegistrations.find(
    (entry) => entry.id === RAPP_PROVIDER_ID,
  );
  if (declaration === undefined) {
    throw new Error("expected RAPP provider registration");
  }
  return { declaration, host };
}

describe("RAPP provider registration", () => {
  it("registers one Brainstem provider with Consumer catalog routing", async () => {
    const { declaration, host } = await registration();
    expect(declaration.displayName).toBe("RAPP Brainstem");
    expect(declaration.experimental_bridgeOptions).toEqual({
      grail: "consumer",
      endpoint: "",
    });
    expect(declaration.models?.fallback).toEqual([
      expect.objectContaining({
        id: RAPP_MODEL_ID,
        displayName: "GitHub Copilot (Brainstem default)",
        isDefault: true,
      }),
    ]);
    expect(declaration.extensionKinds).toHaveProperty("session.state");
    expect(
      Object.keys(host.harness.registrations.settingsDescriptors).sort(),
    ).toEqual(["endpoint", "grail"]);
    expect(
      host.harness.registrations.providerRegistrations.map((entry) => entry.id),
    ).toEqual([RAPP_PROVIDER_ID]);
  });

  it("keeps secrets in host environment and derives only the selected model", async () => {
    const { declaration } = await registration();
    expect(declaration.env?.passthrough).toEqual([
      RAPP_BRAINSTEM_URL_ENV,
      RAPP_BRAINSTEM_SECRET_ENV,
      RAPP_BUSINESS_URL_ENV,
      RAPP_FUNCTION_KEY_ENV,
      RAPP_USER_GUID_ENV,
    ]);
    expect(
      declaration.deriveProviderOptions?.({
        threadId: "thr_rapp",
        projectId: "proj_rapp",
        model: "claude-opus-5",
        permissionMode: "full",
        settings: {
          grail: "consumer",
          endpoint: "http://127.0.0.1:7071",
        },
      }),
    ).toEqual({ model: "claude-opus-5" });
  });

  it("safely re-registers the same provider with Business catalog routing", async () => {
    const { host } = await registration();
    await host.harness.setSettings({
      grail: "business",
      endpoint: "https://example.azurewebsites.net",
    });

    const registrations =
      host.harness.registrations.providerRegistrations.filter(
        (entry) => entry.id === RAPP_PROVIDER_ID,
      );
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.experimental_bridgeOptions).toEqual({
      grail: "business",
      endpoint: "https://example.azurewebsites.net",
    });
    expect(registrations[0]?.models?.fallback).toEqual([
      expect.objectContaining({
        id: RAPP_BUSINESS_MODEL_ID,
        isDefault: true,
      }),
    ]);
  });
});
