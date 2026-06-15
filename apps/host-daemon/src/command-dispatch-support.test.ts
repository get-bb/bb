import type {
  AgentRuntime,
  AgentRuntimeOptions,
} from "@bb/agent-runtime";
import type { AvailableModel } from "@bb/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAgentRuntimeMock = vi.hoisted(() =>
  vi.fn<(options: AgentRuntimeOptions) => AgentRuntime>(),
);

vi.mock("@bb/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/agent-runtime")>();
  return {
    ...actual,
    createAgentRuntime: createAgentRuntimeMock,
  };
});

import { defaultListModels } from "./command-dispatch-support.js";

interface MakeModelArgs {
  id: string;
}

interface MakeRuntimeArgs {
  listModels: AgentRuntime["listModels"];
  shutdown: AgentRuntime["shutdown"];
}

function makeModel(args: MakeModelArgs): AvailableModel {
  return {
    id: args.id,
    model: args.id,
    displayName: args.id,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

function makeRuntime(args: MakeRuntimeArgs): AgentRuntime {
  return {
    async ensureProvider() {},
    async startThread() {
      return { providerThreadId: "provider-thread-test" };
    },
    async resumeThread() {
      return { providerThreadId: "provider-thread-test" };
    },
    async runTurn() {},
    async steerTurn() {
      return { status: "steered" };
    },
    async stopThread() {},
    async renameThread() {},
    async archiveThread() {},
    async unarchiveThread() {},
    listModels: args.listModels,
    listRunningProviders() {
      return [];
    },
    getActiveTurnId() {
      return null;
    },
    async waitForActiveTurn() {
      return null;
    },
    getProviderSession() {
      return null;
    },
    async reapIdleProviderSessions() {
      return { reapedSessions: [] };
    },
    hasThread() {
      return false;
    },
    getActiveThreadIds() {
      return [];
    },
    shutdown: args.shutdown,
  };
}

describe("command dispatch support", () => {
  beforeEach(() => {
    createAgentRuntimeMock.mockReset();
  });

  it("uses a fresh runtime for each default model list probe", async () => {
    const shutdowns: string[] = [];
    const firstModel = makeModel({ id: "model-first" });
    const secondModel = makeModel({ id: "model-second" });
    createAgentRuntimeMock
      .mockReturnValueOnce(
        makeRuntime({
          listModels: async () => ({
            models: [firstModel],
            selectedOnlyModels: [],
          }),
          shutdown: async () => {
            shutdowns.push("first");
          },
        }),
      )
      .mockReturnValueOnce(
        makeRuntime({
          listModels: async () => ({
            models: [secondModel],
            selectedOnlyModels: [],
          }),
          shutdown: async () => {
            shutdowns.push("second");
          },
        }),
      );

    await expect(defaultListModels({ providerId: "codex" })).resolves.toEqual({
      models: [firstModel],
      selectedOnlyModels: [],
    });
    await expect(defaultListModels({ providerId: "codex" })).resolves.toEqual({
      models: [secondModel],
      selectedOnlyModels: [],
    });

    expect(createAgentRuntimeMock).toHaveBeenCalledTimes(2);
    expect(shutdowns).toEqual(["first", "second"]);
  });
});
