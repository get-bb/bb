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

  it("bb provider models renders the shared borderless table", async () => {
    const get = vi.fn(async () => [
      { model: "gpt-5", displayName: "GPT-5", isDefault: true },
    ]);
    stubServerApi({
      "v1.system.execution-options.$get": vi.fn(async () => ({
        providers: [],
        models: await get(),
        selectedOnlyModels: [],
      })),
    });

    await runCommand(["provider", "models", "openai"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Models for openai:",
      "",
      "Model  Name   Default\n-----  -----  -------\ngpt-5  GPT-5  *",
      "",
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
      },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "Models for claude-code:",
      "",
      "Model             Name              Default\n----------------  ----------------  -------\nclaude-opus-4-6   Claude Opus 4.6\n----------------  ----------------  -------\nclaude-haiku-4-5  Claude Haiku 4.5  *",
      "",
    ]);
  });
});
