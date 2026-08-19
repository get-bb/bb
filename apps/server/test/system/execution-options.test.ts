import { describe, expect, it, vi } from "vitest";
import {
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
} from "@bb/host-daemon-contract";
import {
  appendCustomModels,
  listSystemProviderInfos,
  resolveSystemExecutionOptions,
} from "../../src/services/system/execution-options.js";
import { ApiError } from "../../src/errors.js";
import { availableModelFixture } from "../helpers/available-models.js";
import {
  registerHostRpcResponder,
  registerProviderHostRpcResponder,
} from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  createTestProviderRegistry,
  registerFirstPartyProviders,
} from "../helpers/provider-registry.js";
import { createProviderRegistryService } from "../../src/services/providers/provider-registry.js";

const registry = await createTestProviderRegistry();

describe("appendCustomModels", () => {
  it("appends custom models for the requested provider after the catalog", () => {
    const catalogModel = availableModelFixture({
      model: "claude-opus-4-8",
      isDefault: true,
    });

    const { models, selectedOnlyModels } = appendCustomModels(registry, {
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview[1m]",
          displayName: "Example Preview (1M)",
        },
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
      models: [catalogModel],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models.map((model) => model.model)).toEqual([
      "claude-opus-4-8",
      "claude-example-preview[1m]",
    ]);
    expect(models[1]).toMatchObject({
      id: "claude-example-preview[1m]",
      displayName: "Example Preview (1M)",
      defaultReasoningEffort: "medium",
      isDefault: false,
    });
    expect(selectedOnlyModels).toEqual([]);
  });

  it("advertises the full reasoning ladder for claude-code custom models", () => {
    const { models } = appendCustomModels(registry, {
      customModels: [
        { providerId: "claude-code", model: "claude-example-preview" },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(
      models[0].supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "ultracode", "max"]);
  });

  it("uses the provider reasoning ladder for codex and pi custom models", () => {
    const { models: codexModels } = appendCustomModels(registry, {
      customModels: [{ providerId: "codex", model: "custom-model" }],
      models: [],
      providerId: "codex",
      selectedOnlyModels: [],
    });
    expect(
      codexModels[0].supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);

    const { models: piModels } = appendCustomModels(registry, {
      customModels: [{ providerId: "pi", model: "custom-model" }],
      models: [],
      providerId: "pi",
      selectedOnlyModels: [],
    });
    expect(
      piModels[0].supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(piModels[0].defaultReasoningEffort).toBe("medium");
  });

  it("appends dynamic ACP custom models with the agent-managed effort", () => {
    const { models } = appendCustomModels(registry, {
      customModels: [
        {
          providerId: "acp-opencode",
          model: "my-proxy/custom-model",
          displayName: "My Proxy Custom Model",
        },
      ],
      models: [],
      providerId: "acp-opencode",
      selectedOnlyModels: [],
    });

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "my-proxy/custom-model",
      displayName: "My Proxy Custom Model",
      defaultReasoningEffort: "medium",
      isDefault: false,
    });
    // Dynamic ACP ids resolve to the shared ACP policy ladder, the same one
    // that validates reasoning overrides for these providers.
    expect(
      models[0].supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("falls back to the model id when displayName is omitted", () => {
    const { models } = appendCustomModels(registry, {
      customModels: [
        { providerId: "claude-code", model: "claude-example-preview" },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models).toHaveLength(1);
    expect(models[0].displayName).toBe("claude-example-preview");
  });

  it("keeps the catalog entry when a custom model id collides", () => {
    const catalogModel = availableModelFixture({ model: "claude-opus-4-8" });

    const { models } = appendCustomModels(registry, {
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-opus-4-8",
          displayName: "Shadowed",
        },
      ],
      models: [catalogModel],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models).toEqual([catalogModel]);
  });

  it("promotes a selected-only catalog entry instead of synthesizing one", () => {
    const retiredModel = availableModelFixture({
      model: "claude-opus-4-6",
      reasoningLevels: ["low", "medium"],
    });

    const { models, selectedOnlyModels } = appendCustomModels(registry, {
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-opus-4-6",
          displayName: "Ignored",
        },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [retiredModel],
    });

    // The catalog's accurate metadata wins over the synthesized entry, and the
    // promoted model leaves the selected-only pool so it never appears twice.
    expect(models).toEqual([retiredModel]);
    expect(selectedOnlyModels).toEqual([]);
  });

  it("ignores duplicate custom entries for the same model id", () => {
    const { models } = appendCustomModels(registry, {
      customModels: [
        {
          providerId: "claude-code",
          model: "claude-example-preview",
          displayName: "First",
        },
        {
          providerId: "claude-code",
          model: "claude-example-preview",
          displayName: "Second",
        },
      ],
      models: [],
      providerId: "claude-code",
      selectedOnlyModels: [],
    });

    expect(models).toHaveLength(1);
    expect(models[0].displayName).toBe("First");
  });

  it("returns the catalog unchanged when no custom models match", () => {
    const catalogModel = availableModelFixture({ model: "claude-opus-4-8" });
    const retiredModel = availableModelFixture({ model: "claude-opus-4-6" });

    const { models, selectedOnlyModels } = appendCustomModels(registry, {
      customModels: [
        { providerId: "pi", model: "anthropic/claude-example-preview" },
      ],
      models: [catalogModel],
      providerId: "claude-code",
      selectedOnlyModels: [retiredModel],
    });

    expect(models).toEqual([catalogModel]);
    expect(selectedOnlyModels).toEqual([retiredModel]);
  });
});

describe("resolveSystemExecutionOptions", () => {
  it("keeps an unavailable provider in the roster and returns its picker error without probing it", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        await registerFirstPartyProviders(harness.deps.providerRegistry, {
          excludePluginIds: ["provider-acp"],
          unavailablePluginIds: ["provider-codex"],
        });
        const { host } = seedHostSession(harness.deps, {
          id: "host-execution-options-unavailable-provider",
        });

        const response = await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "codex",
        });

        expect(response.providers[0]).toEqual(
          expect.objectContaining({ id: "codex", available: false }),
        );
        expect(response.models).toEqual([]);
        expect(response.selectedOnlyModels).toEqual([]);
        expect(response.modelLoadError).toEqual({
          providerId: "codex",
          code: "provider_unavailable",
        });
      },
    );
  });

  it("includes installed known ACP agents and sends their launch spec when loading models", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-known-acp-installed",
      });
      const catalogModel = availableModelFixture({
        model: "opencode/default",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "known_acp_agents.status") {
            return {
              ok: true,
              result: {
                agents: request.command.agents.map((agent) => ({
                  ...agent,
                  installed: agent.id === "acp-opencode",
                  executablePath:
                    agent.id === "acp-opencode"
                      ? "/opt/homebrew/bin/opencode"
                      : null,
                })),
              },
            };
          }
          if (request.command.type === "provider.list_models") {
            return {
              ok: true,
              result: {
                models: [catalogModel],
                selectedOnlyModels: [],
              },
            };
          }
          throw new Error(`Unexpected RPC command ${request.command.type}`);
        },
      });

      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "acp-opencode",
      });

      expect(response.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "acp-opencode",
            displayName: "opencode",
            available: true,
          }),
        ]),
      );
      expect(response.models).toEqual([catalogModel]);
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["known_acp_agents.status", "provider.list_models"],
      );
      expect(responder.requests[1].command).toMatchObject({
        type: "provider.list_models",
        providerId: "acp-opencode",
        acpLaunchSpec: {
          displayName: "opencode",
          command: "opencode",
          args: ["acp"],
          env: {},
        },
      });
    });
  });

  it("includes installed Grok Build ACP and sends its launch spec when loading models", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-known-grok-installed",
      });
      const catalogModel = availableModelFixture({
        model: "grok-4.5",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "known_acp_agents.status") {
            return {
              ok: true,
              result: {
                agents: request.command.agents.map((agent) => ({
                  ...agent,
                  installed: agent.id === "acp-grok",
                  executablePath:
                    agent.id === "acp-grok"
                      ? "/Users/example/.grok/bin/grok"
                      : null,
                })),
              },
            };
          }
          if (request.command.type === "provider.list_models") {
            return {
              ok: true,
              result: {
                models: [catalogModel],
                selectedOnlyModels: [],
              },
            };
          }
          throw new Error(`Unexpected RPC command ${request.command.type}`);
        },
      });

      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "acp-grok",
      });

      expect(response.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "acp-grok",
            displayName: "Grok Build",
            available: true,
          }),
        ]),
      );
      expect(response.models).toEqual([catalogModel]);
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["known_acp_agents.status", "provider.list_models"],
      );
      expect(responder.requests[1].command).toMatchObject({
        type: "provider.list_models",
        providerId: "acp-grok",
        acpLaunchSpec: {
          displayName: "Grok Build",
          command: "grok",
          args: ["agent", "stdio"],
          env: {},
          modelCli: {
            listArgs: ["models"],
            selectFlag: "--model",
            primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
          },
          permissionCli: {
            full: ["--always-approve"],
            insertAfterArgs: 1,
          },
          reasoningCli: {
            flag: "--reasoning-effort",
            supportedLevels: ["low", "medium", "high"],
            levelValues: {
              none: "low",
              xhigh: "high",
              ultracode: "high",
              max: "high",
            },
            defaultLevel: "high",
          },
        },
      });
    });
  });

  it("includes installed Hermes Agent ACP and sends its launch spec when loading models", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-known-hermes-installed",
      });
      const catalogModel = availableModelFixture({
        model: "openrouter:openai/gpt-5.5",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "known_acp_agents.status") {
            return {
              ok: true,
              result: {
                agents: request.command.agents.map((agent) => ({
                  ...agent,
                  installed: agent.id === "acp-hermes-agent",
                  executablePath:
                    agent.id === "acp-hermes-agent"
                      ? "/Users/example/.local/bin/hermes"
                      : null,
                })),
              },
            };
          }
          if (request.command.type === "provider.list_models") {
            return {
              ok: true,
              result: {
                models: [catalogModel],
                selectedOnlyModels: [],
              },
            };
          }
          throw new Error(`Unexpected RPC command ${request.command.type}`);
        },
      });

      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "acp-hermes-agent",
      });

      expect(response.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "acp-hermes-agent",
            displayName: "Hermes Agent",
            available: true,
          }),
        ]),
      );
      expect(response.models).toEqual([catalogModel]);
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["known_acp_agents.status", "provider.list_models"],
      );
      expect(responder.requests[1].command).toMatchObject({
        type: "provider.list_models",
        providerId: "acp-hermes-agent",
        acpLaunchSpec: {
          displayName: "Hermes Agent",
          command: "hermes",
          args: ["acp"],
          env: {},
          nativeReasoning: {
            configId: "reasoning_effort",
            supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
            defaultLevel: "medium",
          },
        },
      });
    });
  });

  it("omits known ACP agents that the host reports missing", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-known-acp-missing",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "known_acp_agents.status") {
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          }
          return {
            ok: true,
            result: {
              agents: request.command.agents.map((agent) => ({
                ...agent,
                installed: false,
                executablePath: null,
              })),
            },
          };
        },
      });

      const providers = await listSystemProviderInfos(harness.deps, {
        hostId: host.id,
      });

      expect(providers.map((provider) => provider.id)).not.toContain(
        "acp-opencode",
      );
    });
  });

  it.each([
    {
      name: "status returns 502",
      failStatusRequest: false,
    },
    {
      name: "status throws 504",
      failStatusRequest: true,
    },
  ])(
    "keeps built-in and custom providers when known ACP agent $name",
    async ({ failStatusRequest }) => {
      await withTestHarness(
        {
          customAcpAgents: [
            {
              id: "example-agent",
              displayName: "Example Agent",
              command: "example-agent",
              args: ["acp"],
              env: {},
              supportsManualCompaction: false,
            },
          ],
        },
        async (harness) => {
          const warn = vi.fn();
          harness.deps.logger = { ...harness.deps.logger, warn };
          const { host, session } = seedHostSession(harness.deps, {
            id: `host-execution-options-known-acp-status-fails-${failStatusRequest}`,
          });
          const catalogModel = availableModelFixture({ model: "gpt-5.5" });
          const responder = registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: (request) => {
              if (request.command.type === "known_acp_agents.status") {
                return {
                  ok: false,
                  errorCode: "host_unavailable",
                  errorMessage: "Host is not connected",
                };
              }
              if (request.command.type === "provider.list_models") {
                return {
                  ok: true,
                  result: {
                    models: [catalogModel],
                    selectedOnlyModels: [],
                  },
                };
              }
              throw new Error(`Unexpected RPC command ${request.command.type}`);
            },
          });
          if (failStatusRequest) {
            const requestHostOnlineRpc = harness.hub.requestHostOnlineRpc.bind(
              harness.hub,
            );
            vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
              async (args) => {
                if (args.message.command.type === "known_acp_agents.status") {
                  throw new ApiError(
                    504,
                    "command_timeout",
                    "Timed out waiting for command result",
                  );
                }
                return requestHostOnlineRpc(args);
              },
            );
          }

          const response = await resolveSystemExecutionOptions(harness.deps, {
            hostId: host.id,
            providerId: "codex",
          });

          expect(response.providers).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: "codex" }),
              expect.objectContaining({ id: "acp-example-agent" }),
            ]),
          );
          expect(
            response.providers.map((provider) => provider.id),
          ).not.toContain("acp-opencode");
          expect(response.models).toEqual([catalogModel]);
          expect(response.modelLoadError).toBeNull();
          expect(
            responder.requests.map((request) => request.command.type),
          ).toEqual(
            failStatusRequest
              ? ["provider.list_models"]
              : ["known_acp_agents.status", "provider.list_models"],
          );
          const statusWarning = warn.mock.calls.find(
            ([, message]) =>
              message === "Failed to resolve known ACP agent status",
          );
          expect(statusWarning).toBeDefined();
          expect(statusWarning?.[0]).toMatchObject({
            errorCode: failStatusRequest
              ? "command_timeout"
              : "host_unavailable",
            errorMessage: failStatusRequest
              ? "Timed out waiting for command result"
              : "Host is not connected",
            errorStatus: failStatusRequest ? 504 : 502,
            hostId: host.id,
          });
          expect(statusWarning?.[0]).not.toHaveProperty("err");
        },
      );
    },
  );

  it("keeps configured providers and custom models when no host can be resolved", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "example-agent",
            displayName: "Example Agent",
            command: "example-agent",
            args: ["acp"],
            env: {},
            supportsManualCompaction: false,
          },
        ],
        customModels: [
          {
            providerId: "codex",
            model: "gpt-custom",
            displayName: "Custom GPT",
          },
        ],
      },
      async (harness) => {
        const warn = vi.fn();
        harness.deps.logger = { ...harness.deps.logger, warn };
        const response = await resolveSystemExecutionOptions(harness.deps, {
          providerId: "codex",
        });

        expect(response.providers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "codex" }),
            expect.objectContaining({ id: "acp-example-agent" }),
          ]),
        );
        expect(response.providers.map((provider) => provider.id)).not.toContain(
          "acp-opencode",
        );
        expect(response.models).toEqual([
          expect.objectContaining({
            model: "gpt-custom",
            displayName: "Custom GPT",
          }),
        ]);
        expect(response.modelLoadError).toEqual({
          providerId: "codex",
          code: "failed",
        });
        const hostLookupWarning = warn.mock.calls.find(
          ([, message]) =>
            message === "Failed to resolve host for known ACP agent status",
        );
        expect(hostLookupWarning).toBeDefined();
        expect(hostLookupWarning?.[0]).toMatchObject({
          errorCode: "host_unavailable",
          errorMessage: "Local host daemon is not initialized",
          errorStatus: 502,
        });
        expect(hostLookupWarning?.[0]).not.toHaveProperty("err");
      },
    );
  });

  it("uses the custom ACP config when it collides with a known ACP agent", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "opencode",
            displayName: "Custom opencode",
            command: "custom-opencode",
            args: ["serve"],
            env: { CUSTOM_OPENCODE: "1" },
            supportsManualCompaction: false,
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-known-acp-override",
        });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: (request) => {
            if (request.command.type === "known_acp_agents.status") {
              // acp-omp, acp-grok, and acp-hermes-agent are known agents that
              // are not overridden by custom config here, so the server probes
              // host install status for them.
              return { ok: true, result: { agents: [] } };
            }
            if (request.command.type === "provider.list_models") {
              return {
                ok: true,
                result: { models: [], selectedOnlyModels: [] },
              };
            }
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          },
        });

        const response = await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "acp-opencode",
        });

        const opencodeProviders = response.providers.filter(
          (provider) => provider.id === "acp-opencode",
        );
        expect(opencodeProviders).toHaveLength(1);
        expect(opencodeProviders[0].displayName).toBe("Custom opencode");
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual(["known_acp_agents.status", "provider.list_models"]);
        expect(responder.requests[1].command).toMatchObject({
          type: "provider.list_models",
          providerId: "acp-opencode",
          acpLaunchSpec: {
            displayName: "Custom opencode",
            command: "custom-opencode",
            args: ["serve"],
            env: { CUSTOM_OPENCODE: "1" },
          },
        });
      },
    );
  });

  it("keeps custom models selectable when the provider model list fails to load", async () => {
    await withTestHarness(
      {
        customModels: [
          {
            providerId: "claude-code",
            model: "claude-example-preview",
            displayName: "Example Preview",
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-model-load-error",
        });
        registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          modelErrorsByProviderId: {
            "claude-code": {
              errorCode: "provider_rpc_error",
              errorMessage: "Provider failed",
            },
          },
        });

        const response = await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "claude-code",
        });

        expect(response.modelLoadError).toEqual({
          providerId: "claude-code",
          code: "failed",
        });
        // A transient failure serves the provisional alias catalog, and custom
        // models stay appended after it.
        expect(response.models.map((model) => model.model)).toEqual([
          "claude-fable-5",
          "claude-opus-5[1m]",
          "claude-opus-4-8[1m]",
          "claude-opus-4-7[1m]",
          "claude-sonnet-5",
          "claude-example-preview",
        ]);
        expect(response.selectedOnlyModels).toEqual([]);
      },
    );
  });

  it("serves the curated Claude catalog when the model probe fails transiently", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-claude-provisional",
      });
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelErrorsByProviderId: {
          "claude-code": {
            errorCode: "command_timeout",
            errorMessage: "Model probe timed out",
          },
        },
      });

      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "claude-code",
      });

      // The catalog is provisional, so the error must still be reported:
      // callers gate thread model recovery on `modelLoadError` being null.
      expect(response.modelLoadError).toEqual({
        providerId: "claude-code",
        code: "timeout",
      });
      expect(response.models.map((model) => model.model)).toEqual([
        "claude-fable-5",
        "claude-opus-5[1m]",
        "claude-opus-4-8[1m]",
        "claude-opus-4-7[1m]",
        "claude-sonnet-5",
      ]);
      expect(
        response.models
          .filter((model) => model.isDefault)
          .map((model) => model.model),
      ).toEqual(["claude-opus-5[1m]"]);
    });
  });

  it.each([
    ["auth required", "auth_required"],
    ["missing executable", "missing_executable"],
  ] as const)(
    "offers no provisional Claude models for %s setup failures",
    async (_name, errorCode) => {
      await withTestHarness({}, async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: `host-execution-options-claude-${errorCode}`,
        });
        registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          modelErrorsByProviderId: {
            "claude-code": {
              errorCode,
              errorMessage: "Claude Code is not usable",
            },
          },
        });

        const response = await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "claude-code",
        });

        // These are actionable setup states the app routes to an install/auth
        // prompt. Offering models would only defer the failure to submit time.
        expect(response.modelLoadError).toEqual({
          providerId: "claude-code",
          code: errorCode,
        });
        expect(response.models).toEqual([]);
      });
    },
  );

  it("logs model load fallback errors without stack-bearing err objects", async () => {
    await withTestHarness(async (harness) => {
      const warn = vi.fn();
      harness.deps.logger = { ...harness.deps.logger, warn };
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-concise-model-log",
      });
      registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelErrorsByProviderId: {
          codex: {
            errorCode: "command_failed",
            errorMessage: "model list failed",
          },
        },
      });

      await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "codex",
      });

      const providerModelWarning = warn.mock.calls.find(
        ([, message]) => message === "Failed to resolve provider models",
      );
      expect(providerModelWarning).toBeDefined();
      expect(providerModelWarning?.[0]).toMatchObject({
        errorCode: "command_failed",
        errorMessage: "model list failed",
        errorRetryable: false,
        errorStatus: 502,
        hostId: host.id,
        providerId: "codex",
      });
      expect(providerModelWarning?.[0]).not.toHaveProperty("err");
    });
  });

  it("includes custom ACP agents and sends their launch spec when loading models", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "example-agent",
            displayName: "Example Agent",
            command: "example-agent",
            args: ["acp", "--stdio"],
            env: { EXAMPLE_TOKEN: "test-token" },
            supportsManualCompaction: false,
            cwd: "/tmp/example-agent",
            modelCli: {
              listArgs: ["models", "--json"],
              selectFlag: "--model",
              primaryModels: ["example/default"],
            },
          },
        ],
      },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-custom-acp",
        });
        const catalogModel = availableModelFixture({
          model: "example/default",
        });
        const responder = registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          modelsByProviderId: {
            "acp-example-agent": {
              models: [catalogModel],
              selectedOnlyModels: [],
            },
          },
        });

        const response = await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "acp-example-agent",
        });

        expect(response.providers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "acp-example-agent",
              displayName: "Example Agent",
              available: true,
              composerActions: [{ kind: "skills", trigger: "/" }],
              capabilities: expect.objectContaining({
                supportsFork: true,
                supportsServiceTier: true,
                permissionModes: ["accept-edits", "full"],
              }),
            }),
          ]),
        );
        expect(response.models).toEqual([catalogModel]);
        expect(response.selectedOnlyModels).toEqual([]);
        expect(response.modelLoadError).toBeNull();
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual(["known_acp_agents.status", "provider.list_models"]);
        expect(responder.requests[1].command).toMatchObject({
          type: "provider.list_models",
          providerId: "acp-example-agent",
          acpLaunchSpec: {
            displayName: "Example Agent",
            command: "example-agent",
            args: ["acp", "--stdio"],
            env: { EXAMPLE_TOKEN: "test-token" },
            cwd: "/tmp/example-agent",
            modelCli: {
              listArgs: ["models", "--json"],
              selectFlag: "--model",
              primaryModels: ["example/default"],
            },
          },
        });
      },
    );
  });

  // The HTTP listener deliberately starts serving before plugins load, and
  // providers now exist only while their plugin is loaded, so a request that
  // lands in that window must wait instead of reporting no providers at all.
  it("waits for plugin provider registrations before answering with an empty registry", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        const registry = createProviderRegistryService({
          deferRegistrationsSettled: true,
        });
        harness.deps.providerRegistry = registry;
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-boot-window",
        });
        registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });

        const providersPromise = listSystemProviderInfos(harness.deps, {});
        // Plugin startup lands after the request already began.
        await registerFirstPartyProviders(registry);
        registry.markRegistrationsSettled();

        expect((await providersPromise).map((provider) => provider.id)).toEqual(
          ["codex", "claude-code", "pi", "acp-cursor"],
        );
      },
    );
  });

  it("answers a provider-scoped picker request before unrelated plugins finish loading", async () => {
    await withTestHarness(
      { seedFirstPartyProviders: false },
      async (harness) => {
        const registry = createProviderRegistryService({
          deferRegistrationsSettled: true,
        });
        harness.deps.providerRegistry = registry;
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-provider-ready",
        });
        registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });

        const optionsPromise = resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "pi",
        });
        await registerFirstPartyProviders(registry, {
          excludePluginIds: [
            "provider-acp",
            "provider-claude-code",
            "provider-codex",
          ],
        });

        const response = await optionsPromise;
        expect(response.providers.map((provider) => provider.id)).toEqual([
          "pi",
        ]);
        expect(response.modelLoadError).toBeNull();

        // Full plugin startup is intentionally still outstanding. It may
        // complete later and invalidate this partial boot-time roster.
        registry.markRegistrationsSettled();
      },
    );
  });

  // Dynamic ACP ids run on the ACP plugin's bridge and are never registered
  // themselves, so with that plugin disabled they have no bridge anywhere:
  // listing them would offer agents whose first turn fails on the daemon.
  it("omits custom and known ACP agents when no ACP provider plugin is registered", async () => {
    await withTestHarness(
      {
        seedFirstPartyProviders: false,
        customAcpAgents: [
          {
            id: "example-agent",
            displayName: "Example Agent",
            command: "example-agent",
            args: ["acp", "--stdio"],
            env: {},
            supportsManualCompaction: false,
          },
        ],
      },
      async (harness) => {
        await registerFirstPartyProviders(harness.deps.providerRegistry, {
          excludePluginIds: ["provider-acp"],
        });
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-execution-options-no-acp-plugin",
        });
        const responder = registerProviderHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });

        const providers = await listSystemProviderInfos(harness.deps, {
          hostId: host.id,
        });

        expect(providers.map((provider) => provider.id)).toEqual([
          "codex",
          "claude-code",
          "pi",
        ]);
        // Nothing ACP to offer, so the host is never probed for installed
        // known agents either.
        expect(
          responder.requests.map((request) => request.command.type),
        ).toEqual([]);
      },
    );
  });

  it("surfaces provider auth-required model load failures", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-execution-options-auth-required",
      });
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelErrorsByProviderId: {
          "acp-cursor": {
            errorCode: "auth_required",
            errorMessage: "Cursor agent is not authenticated.",
          },
        },
      });

      const response = await resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "acp-cursor",
      });

      expect(response.modelLoadError).toEqual({
        providerId: "acp-cursor",
        code: "auth_required",
      });
      expect(responder.requests.map((request) => request.command.type)).toEqual(
        ["known_acp_agents.status", "provider.list_models"],
      );
      expect(responder.requests[1].command).toMatchObject({
        type: "provider.list_models",
        providerId: "acp-cursor",
      });
      expect(response.models).toEqual([]);
      expect(response.selectedOnlyModels).toEqual([]);
    });
  });

  it.each([
    ["missing executable", "missing_executable", "missing_executable"],
    ["auth required", "auth_required", "auth_required"],
    ["launch failure", "command_failed", "failed"],
  ] as const)(
    "surfaces dynamic ACP model-load %s errors with the custom provider identity",
    async (_name, hostErrorCode, expectedCode) => {
      await withTestHarness(
        {
          customAcpAgents: [
            {
              id: "broken-agent",
              displayName: "Broken Agent",
              command: "broken-agent",
              args: [],
              env: {},
              supportsManualCompaction: false,
            },
          ],
        },
        async (harness) => {
          const { host, session } = seedHostSession(harness.deps, {
            id: `host-execution-options-${hostErrorCode}`,
          });
          registerProviderHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            modelErrorsByProviderId: {
              "acp-broken-agent": {
                errorCode: hostErrorCode,
                errorMessage: "model list failed",
              },
            },
          });

          const response = await resolveSystemExecutionOptions(harness.deps, {
            hostId: host.id,
            providerId: "acp-broken-agent",
          });

          expect(response.modelLoadError).toEqual({
            providerId: "acp-broken-agent",
            code: expectedCode,
          });
          expect(response.providers).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: "acp-broken-agent",
                displayName: "Broken Agent",
              }),
            ]),
          );
        },
      );
    },
  );
});

/**
 * A daemon socket that holds every `provider.list_models` request until the
 * test releases it, so two callers can be observed sharing one probe.
 */
function registerHeldModelListResponder(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string; modelId: string },
): {
  requests: HostDaemonOnlineRpcRequestMessage[];
  release(): void;
} {
  const requests: HostDaemonOnlineRpcRequestMessage[] = [];
  harness.hub.registerDaemon(args.sessionId, args.hostId, {
    close() {},
    send(data: string) {
      const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
      if (message.type !== "host-rpc.request") {
        throw new Error(`Unexpected daemon websocket message ${message.type}`);
      }
      if (message.command.type === "known_acp_agents.status") {
        harness.hub.recordHostOnlineRpcResponse({
          sessionId: args.sessionId,
          message: {
            type: "host-rpc.response",
            requestId: message.requestId,
            commandType: message.command.type,
            ok: true,
            result: {
              agents: message.command.agents.map((agent) => ({
                ...agent,
                installed: false,
                executablePath: null,
              })),
            },
          },
        });
        return;
      }
      if (message.command.type !== "provider.list_models") {
        throw new Error(`Unexpected RPC command ${message.command.type}`);
      }
      requests.push(message);
    },
  });
  return {
    requests,
    release() {
      for (const request of requests) {
        harness.hub.recordHostOnlineRpcResponse({
          sessionId: args.sessionId,
          message: {
            type: "host-rpc.response",
            requestId: request.requestId,
            commandType: "provider.list_models",
            ok: true,
            result: {
              models: [availableModelFixture({ model: args.modelId })],
              selectedOnlyModels: [],
            },
          },
        });
      }
    },
  };
}

function seedEnvironmentPath(
  harness: TestAppHarness,
  args: { hostId: string; path: string },
): string {
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: args.hostId,
    path: args.path,
  });
  return seedEnvironment(harness.deps, {
    hostId: args.hostId,
    projectId: project.id,
    path: args.path,
  }).id;
}

describe("resolveSystemExecutionOptions model probe memo", () => {
  it("serves a host-scoped catalog to every environment on the host from one probe without the workspace path", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-model-memo-shared",
      });
      const catalogModel = availableModelFixture({ model: "claude-opus-5" });
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          "claude-code": { models: [catalogModel], selectedOnlyModels: [] },
        },
      });
      const environmentA = seedEnvironmentPath(harness, {
        hostId: host.id,
        path: "/tmp/memo-workspace-a",
      });
      const environmentB = seedEnvironmentPath(harness, {
        hostId: host.id,
        path: "/tmp/memo-workspace-b",
      });

      const responses = [
        await resolveSystemExecutionOptions(harness.deps, {
          environmentId: environmentA,
          providerId: "claude-code",
        }),
        await resolveSystemExecutionOptions(harness.deps, {
          environmentId: environmentB,
          providerId: "claude-code",
        }),
        await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "claude-code",
        }),
      ];

      for (const response of responses) {
        expect(response.models).toEqual([catalogModel]);
        expect(response.modelLoadError).toBeNull();
      }
      const modelListCommands = responder.requests
        .map((request) => request.command)
        .filter((command) => command.type === "provider.list_models");
      expect(modelListCommands).toHaveLength(1);
      expect(modelListCommands[0]).not.toHaveProperty("cwd");
    });
  });

  it("keeps a workspace-scoped catalog keyed by workspace path", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-model-memo-workspace-scoped",
      });
      const responder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          pi: {
            models: [availableModelFixture({ model: "anthropic/opus" })],
            selectedOnlyModels: [],
          },
        },
      });
      const environmentA = seedEnvironmentPath(harness, {
        hostId: host.id,
        path: "/tmp/memo-pi-a",
      });
      const environmentB = seedEnvironmentPath(harness, {
        hostId: host.id,
        path: "/tmp/memo-pi-b",
      });

      for (const environmentId of [environmentA, environmentA, environmentB]) {
        await resolveSystemExecutionOptions(harness.deps, {
          environmentId,
          providerId: "pi",
        });
      }

      expect(
        responder.requests
          .map((request) => request.command)
          .filter((command) => command.type === "provider.list_models")
          .map((command) => command.cwd),
      ).toEqual(["/tmp/memo-pi-a", "/tmp/memo-pi-b"]);
    });
  });

  it("shares one in-flight probe between concurrent readers", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-model-memo-inflight",
      });
      const responder = registerHeldModelListResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelId: "gpt-5",
      });

      const pending = Promise.all([
        resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "codex",
        }),
        resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "codex",
        }),
      ]);
      await vi.waitFor(() => {
        expect(responder.requests.length).toBeGreaterThan(0);
      });
      responder.release();
      const [first, second] = await pending;

      expect(first.models.map((model) => model.model)).toEqual(["gpt-5"]);
      expect(second.models).toEqual(first.models);
      expect(
        responder.requests.filter(
          (request) => request.command.type === "provider.list_models",
        ),
      ).toHaveLength(1);
    });
  });

  it("does not memoize a failed probe and re-probes after the daemon reconnects", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-model-memo-invalidation",
      });
      const catalogModel = availableModelFixture({ model: "gpt-5" });
      let failProbe = true;
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "known_acp_agents.status") {
            return {
              ok: true,
              result: {
                agents: request.command.agents.map((agent) => ({
                  ...agent,
                  installed: false,
                  executablePath: null,
                })),
              },
            };
          }
          if (request.command.type !== "provider.list_models") {
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          }
          if (failProbe) {
            return {
              ok: false,
              errorCode: "command_timeout",
              errorMessage: "Model probe timed out",
            };
          }
          return {
            ok: true,
            result: { models: [catalogModel], selectedOnlyModels: [] },
          };
        },
      });
      const query = { hostId: host.id, providerId: "codex" };

      const failed = await resolveSystemExecutionOptions(harness.deps, query);
      expect(failed.modelLoadError).toEqual({
        providerId: "codex",
        code: "timeout",
      });

      failProbe = false;
      const recovered = await resolveSystemExecutionOptions(
        harness.deps,
        query,
      );
      expect(recovered.modelLoadError).toBeNull();
      expect(recovered.models).toEqual([catalogModel]);
      await resolveSystemExecutionOptions(harness.deps, query);
      expect(
        responder.requests.filter(
          (request) => request.command.type === "provider.list_models",
        ),
      ).toHaveLength(2);

      // A reconnected daemon may run a different CLI or account: its first
      // probe must not be answered from the previous session's memo.
      harness.hub.unregisterDaemon(session.id);
      const nextSession = seedSession(harness.deps, host.id);
      const nextResponder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: nextSession.id,
        modelsByProviderId: {
          codex: {
            models: [availableModelFixture({ model: "gpt-6" })],
            selectedOnlyModels: [],
          },
        },
      });
      const afterReconnect = await resolveSystemExecutionOptions(
        harness.deps,
        query,
      );
      expect(afterReconnect.models.map((model) => model.model)).toEqual([
        "gpt-6",
      ]);
      expect(
        nextResponder.requests.filter(
          (request) => request.command.type === "provider.list_models",
        ),
      ).toHaveLength(1);
    });
  });
});
