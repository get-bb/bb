import { createBuiltinPlanCommandTextInput } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { assertProviderAcceptsPromptActions } from "../../src/services/providers/provider-plan-command.js";
import { createProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { minimalProviderRegistration } from "../helpers/provider-registry.js";

const BASE_INFO = {
  pluginId: "provider-test",
  available: true,
  maintenance: { health: false, usage: false, installation: false },
  capabilities: {
    supportsThreadArchive: false,
    supportsThreadRename: false,
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    supportsFork: false,
    supportsSessionRewind: false,
    modelCatalogScope: "workspace" as const,
    permissionModes: ["full" as const],
  },
  completedTurnDisplay: "collapse" as const,
  logoUrl: null,
};

function registryWith(): ReturnType<typeof createProviderRegistryService> {
  const registry = createProviderRegistryService();
  for (const [id, displayName, composerActions] of [
    ["pi", "Pi", []],
    [
      "claude-code",
      "Claude Code",
      [
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: "" },
        },
      ],
    ],
  ] as const) {
    registry.register(
      minimalProviderRegistration({
        pluginId: `provider-${id}`,
        info: {
          ...BASE_INFO,
          id,
          displayName,
          composerActions: [...composerActions],
        },
        serverCapabilities: {
          supportsManualCompaction: false,
          reasoningLevels: ["medium"],
          fork: "none",
        },
      }),
    );
  }
  return registry;
}

describe("plan request capability gate", () => {
  const planInput = [createBuiltinPlanCommandTextInput("Plan adding HELLO.md")];

  it("rejects a plan request for a provider that declares no plan action", () => {
    expect(() =>
      assertProviderAcceptsPromptActions(registryWith(), {
        input: planInput,
        providerId: "pi",
      }),
    ).toThrow(
      new ApiError(
        400,
        "invalid_request",
        "Pi has no plan mode, so this message cannot be sent as a plan request. Send it without --plan.",
      ),
    );
  });

  it("accepts a plan request for a provider with a plan action, and plain text for any provider", () => {
    const registry = registryWith();
    expect(() =>
      assertProviderAcceptsPromptActions(registry, {
        input: planInput,
        providerId: "claude-code",
      }),
    ).not.toThrow();
    expect(() =>
      assertProviderAcceptsPromptActions(registry, {
        input: [{ type: "text", text: "/plan by hand", mentions: [] }],
        providerId: "pi",
      }),
    ).not.toThrow();
  });
});
