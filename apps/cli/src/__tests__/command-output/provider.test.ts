import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerProviderCommands } from "../../commands/provider.js";

describe("bb provider command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerProviderCommands(program, () => "http://server");

  it("bb provider list renders the shared borderless table", async () => {
    const get = vi.fn(async () => [{ id: "openai", displayName: "OpenAI" }]);
    stubServerApi({ "v1.system.providers.$get": get });

    await runCommand(["provider", "list"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "",
      "ID      Name  \n------  ------\nopenai  OpenAI",
      "",
    ]);
  });

  it("bb provider list resolves a machine and preserves portable JSON output", async () => {
    const getProviders = vi.fn(async () => [
      { id: "acp-remote", displayName: "Remote ACP" },
    ]);
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          status: "connected",
          lastSeenAt: 1,
          route: null,
          lastRejectedProtocolVersion: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.system.providers.$get": getProviders,
    });

    await runCommand(
      ["provider", "list", "--machine", "builder", "--json"],
      register,
    );

    expect(getProviders).toHaveBeenCalledWith({
      query: { hostId: "host-remote" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        [{ id: "acp-remote", displayName: "Remote ACP" }],
        null,
        2,
      ),
    ]);
  });

  it("bb provider models includes a matching selected-only model", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [
        {
          model: "claude-haiku-4-5",
          displayName: "Claude Haiku 4.5",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [
        {
          model: "claude-opus-4-6",
          displayName: "Claude Opus 4.6",
          isDefault: false,
        },
      ],
      modelLoadError: null,
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(
      [
        "provider",
        "models",
        "claude-code",
        "--selected-model",
        "claude-opus-4-6",
      ],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: {
        providerId: "claude-code",
        selectedModel: "claude-opus-4-6",
      },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Models for claude-code:",
      "",
      "Model             Name              Default\n----------------  ----------------  -------\nclaude-opus-4-6   Claude Opus 4.6\n----------------  ----------------  -------\nclaude-haiku-4-5  Claude Haiku 4.5  *",
      "",
    ]);
  });

  it("bb provider models includes deduplicated selected-only models without --selected-model", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [
        {
          model: "default",
          displayName: "Auto",
          isDefault: true,
        },
        {
          model: "grok-4.6",
          displayName: "Grok 4.6",
          isDefault: false,
        },
      ],
      selectedOnlyModels: [
        {
          model: "grok-4.6",
          displayName: "Grok 4.6 duplicate",
          isDefault: false,
        },
        {
          model: "gemini-4-neon",
          displayName: "Gemini 4 Neon",
          isDefault: false,
        },
        {
          model: "gemini-4-neon",
          displayName: "Gemini 4 Neon duplicate",
          isDefault: false,
        },
        {
          model: "grok-4.7",
          displayName: "Grok 4.7",
          isDefault: false,
        },
      ],
      modelLoadError: null,
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(["provider", "models", "acp-cursor", "--json"], register);

    expect(get).toHaveBeenCalledWith({
      query: {
        providerId: "acp-cursor",
      },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        [
          {
            model: "default",
            displayName: "Auto",
            isDefault: true,
          },
          {
            model: "grok-4.6",
            displayName: "Grok 4.6",
            isDefault: false,
          },
          {
            model: "gemini-4-neon",
            displayName: "Gemini 4 Neon",
            isDefault: false,
          },
          {
            model: "grok-4.7",
            displayName: "Grok 4.7",
            isDefault: false,
          },
        ],
        null,
        2,
      ),
    ]);
  });

  it("bb provider models promotes --selected-model while still listing other selected-only models", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [
        {
          model: "default",
          displayName: "Auto",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [
        {
          model: "gemini-4-neon",
          displayName: "Gemini 4 Neon",
          isDefault: false,
        },
        {
          model: "grok-4.7",
          displayName: "Grok 4.7",
          isDefault: false,
        },
      ],
      modelLoadError: null,
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(
      [
        "provider",
        "models",
        "acp-cursor",
        "--selected-model",
        "grok-4.7",
        "--json",
      ],
      register,
    );

    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!).map(
        (entry: { model: string }) => entry.model,
      ),
    ).toEqual(["grok-4.7", "default", "gemini-4-neon"]);
  });

  it("bb provider models routes through an environment", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(
      ["provider", "models", "codex", "--environment", "env-remote", "--json"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: { environmentId: "env-remote", providerId: "codex" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual(["[]"]);
  });

  it("bb provider models names the project whose checkout scopes the list", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(
      ["provider", "models", "acp-opencode", "--project", "proj_1", "--json"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: { projectId: "proj_1", providerId: "acp-opencode" },
    });
    await expect(
      runCommand(
        [
          "provider",
          "models",
          "acp-opencode",
          "--project",
          "proj_1",
          "--environment",
          "env_1",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      "Error: Cannot combine --project with --environment; the environment already selects its workspace.",
    );
  });

  it("bb provider models reports a model-load failure and its detail on stderr", async () => {
    const get = vi.fn(async () => ({
      providers: [],
      models: [],
      selectedOnlyModels: [],
      modelLoadError: {
        providerId: "codex",
        code: "failed",
        detail: "bb could not find the Codex CLI on this machine.",
      },
    }));
    stubServerApi({ "v1.system.execution-options.$get": get });

    await runCommand(["provider", "models", "codex"], register);

    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["Could not load models for codex (failed)"],
      ["  bb could not find the Codex CLI on this machine."],
    ]);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "No models available",
    ]);
  });

  it("rejects simultaneous machine and environment selectors", async () => {
    await expect(
      runCommand(
        [
          "provider",
          "list",
          "--host",
          "builder",
          "--environment",
          "env-remote",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      "Error: Cannot combine --machine or --host with --environment; the environment already selects its machine.",
    );
  });
});
