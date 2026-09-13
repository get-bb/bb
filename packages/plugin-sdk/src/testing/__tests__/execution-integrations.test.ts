import { expect, it } from "vitest";
import { createFakePluginHost } from "../index.js";
import type { ExperimentalPluginExecutionIntegrationDeclaration } from "../../backend-contract.js";

const declaration: ExperimentalPluginExecutionIntegrationDeclaration = {
  id: "external-execution",
  displayName: "External execution",
  hostIds: ["host-one"],
  providers: [
    {
      id: "codex",
      displayName: "Codex",
      maintenance: { health: false, usage: false, installation: false },
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        fork: "none",
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ["full"],
        reasoningLevels: ["medium"],
      },
      composerActions: [],
    },
  ],
};

it("keeps integration harness registrations separate and disposes them on reload", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "external",
    experimental_hostEntry: true,
  });
  bb.providers.register(declaration.providers[0]!);
  bb.providers.experimental_registerExecutionIntegration(declaration);
  expect(harness.registrations.providerRegistrations).toHaveLength(1);
  expect(
    harness.registrations.executionIntegrationRegistrations
      .get(declaration.id)
      ?.providers.map((provider) => provider.id),
  ).toEqual(["codex"]);
  expect(() =>
    bb.providers.experimental_registerExecutionIntegration(declaration),
  ).toThrow(/already registered/);
  const replacement = await harness.lifecycle.reload((api) => {
    api.providers.experimental_registerExecutionIntegration(declaration);
  });
  expect(harness.registrations.providerRegistrations).toEqual([]);
  expect(harness.registrations.executionIntegrationRegistrations.size).toBe(0);
  expect(
    replacement.harness.registrations.executionIntegrationRegistrations.size,
  ).toBe(1);
  await replacement.harness.lifecycle.dispose();
  expect(
    replacement.harness.registrations.executionIntegrationRegistrations.size,
  ).toBe(0);
});

it("refuses duplicate harnesses and invalid integration declarations", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "external",
    experimental_hostEntry: true,
  });
  expect(() =>
    bb.providers.experimental_registerExecutionIntegration({
      ...declaration,
      providers: [...declaration.providers, ...declaration.providers],
    }),
  ).toThrow(/only once/);
  expect(() =>
    bb.providers.experimental_registerExecutionIntegration({
      ...declaration,
      id: "bb",
    }),
  ).toThrow(/reserved/);
  expect(() =>
    bb.providers.experimental_registerExecutionIntegration({
      ...declaration,
      hostIds: [],
    }),
  ).toThrow();
  expect(harness.registrations.executionIntegrationRegistrations.size).toBe(0);
  await harness.lifecycle.dispose();
});
