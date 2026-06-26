import { describe, expect, it, vi } from "vitest";
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
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("appendCustomModels", () => {
  it("appends custom models for the requested provider after the catalog", () => {
    const catalogModel = availableModelFixture({
      model: "claude-opus-4-8",
      isDefault: true,
    });

    const { models, selectedOnlyModels } = appendCustomModels({
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
    const { models } = appendCustomModels({
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

  it("caps codex and pi custom models at xhigh (no max)", () => {
    for (const providerId of ["codex", "pi"] as const) {
      const { models } = appendCustomModels({
        customModels: [{ providerId, model: "custom-model" }],
        models: [],
        providerId,
        selectedOnlyModels: [],
      });

      expect(
        models[0].supportedReasoningEfforts.map(
          (effort) => effort.reasoningEffort,
        ),
      ).toEqual(["low", "medium", "high", "xhigh"]);
    }
  });

  it("falls back to the model id when displayName is omitted", () => {
    const { models } = appendCustomModels({
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

    const { models } = appendCustomModels({
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

    const { models, selectedOnlyModels } = appendCustomModels({
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
    const { models } = appendCustomModels({
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

    const { models, selectedOnlyModels } = appendCustomModels({
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
      expect(responder.requests[1].command).toEqual({
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
        ).toEqual(["provider.list_models"]);
        expect(responder.requests[0].command).toEqual({
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
        expect(response.models).toEqual([
          expect.objectContaining({
            model: "claude-example-preview",
            displayName: "Example Preview",
          }),
        ]);
        expect(response.selectedOnlyModels).toEqual([]);
      },
    );
  });

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
              composerActions: [],
              capabilities: expect.objectContaining({
                supportsFork: false,
                supportsServiceTier: true,
                supportedPermissionModes: [
                  "full",
                  "workspace-write",
                  "readonly",
                ],
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
        expect(responder.requests[1].command).toEqual({
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
      expect(responder.requests[1].command).toEqual({
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
