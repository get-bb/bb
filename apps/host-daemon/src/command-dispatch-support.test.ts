import type { AgentRuntime, AgentRuntimeOptions } from "@bb/agent-runtime";
import type { AvailableModel } from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH } from "../test/command/dispatch-helpers.js";

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

import {
  CommandDispatchError,
  defaultListModels,
  getErrorCode,
  isExpectedOnlineRpcFailureError,
  shutdownDefaultListModelsRuntimes,
} from "./command-dispatch-support.js";

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
    async prepareThreadRewind() {
      return { providerThreadId: "provider-thread-rewind-test" };
    },
    async discardThreadRewind() {},
    async resumeThread() {
      return { providerThreadId: "provider-thread-test" };
    },
    async runTurn() {},
    async steerTurn() {
      return { status: "steered" };
    },
    async stopThread() {
      return { providerCheckpointId: null };
    },
    async clearThreadGoal() {
      return { cleared: true };
    },
    async renameThread() {},
    async archiveThread() {},
    async unarchiveThread() {},
    listModels: args.listModels,
    async providerHealth() {
      return { supported: false as const };
    },
    async providerUsage() {
      return { supported: false as const };
    },
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
    getLiveThreadIds() {
      return [];
    },
    hasOpenBackgroundWork() {
      return false;
    },
    shutdown: args.shutdown,
  };
}

describe("command dispatch support", () => {
  afterEach(async () => {
    await shutdownDefaultListModelsRuntimes();
  });

  beforeEach(() => {
    createAgentRuntimeMock.mockReset();
  });

  it("classifies ACP model-list authentication errors", () => {
    expect(getErrorCode(new Error("ACP agent is not authenticated."))).toBe(
      "auth_required",
    );
    expect(
      getErrorCode(
        new Error(
          "Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.",
        ),
      ),
    ).toBe("auth_required");
  });

  it("classifies oversized file reads as expected RPC failures", () => {
    expect(
      isExpectedOnlineRpcFailureError(
        new CommandDispatchError("file_too_large", "File exceeds the limit"),
      ),
    ).toBe(true);
  });

  it("reuses the default model list runtime until shutdown", async () => {
    const shutdowns: string[] = [];
    const firstModel = makeModel({ id: "model-first" });
    const secondModel = makeModel({ id: "model-second" });
    const listModels = vi
      .fn<AgentRuntime["listModels"]>()
      .mockResolvedValueOnce({
        models: [firstModel],
        selectedOnlyModels: [],
      })
      .mockResolvedValueOnce({
        models: [secondModel],
        selectedOnlyModels: [],
      });
    createAgentRuntimeMock.mockReturnValue(
      makeRuntime({
        listModels,
        shutdown: async () => {
          shutdowns.push("runtime");
        },
      }),
    );

    await expect(
      defaultListModels({
        providerId: "codex",
        bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
      }),
    ).resolves.toEqual({
      models: [firstModel],
      selectedOnlyModels: [],
    });
    await expect(
      defaultListModels({
        providerId: "codex",
        bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
      }),
    ).resolves.toEqual({
      models: [secondModel],
      selectedOnlyModels: [],
    });

    expect(createAgentRuntimeMock).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(shutdowns).toEqual([]);

    await shutdownDefaultListModelsRuntimes();
    expect(shutdowns).toEqual(["runtime"]);
  });

  it("forwards acp launch specs to the default model-list runtime", async () => {
    const launchSpec: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["serve"],
      env: {},
    };
    const listModels = vi.fn<AgentRuntime["listModels"]>().mockResolvedValue({
      models: [],
      selectedOnlyModels: [],
    });
    createAgentRuntimeMock.mockReturnValue(
      makeRuntime({
        listModels,
        shutdown: async () => {},
      }),
    );

    await defaultListModels({
      providerId: "acp-custom",
      acpLaunchSpec: launchSpec,
      bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
    });

    expect(listModels).toHaveBeenCalledWith({
      providerId: "acp-custom",
      acpLaunchSpec: launchSpec,
      bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
    });
  });

  it("creates a new default model-list runtime when the acp launch spec changes", async () => {
    const firstSpec: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["serve"],
      env: { CACHE_MARKER: "first" },
    };
    const secondSpec: HostDaemonAcpLaunchSpec = {
      displayName: "Custom ACP",
      command: "custom-agent",
      args: ["serve"],
      env: { CACHE_MARKER: "second" },
    };
    const shutdowns: string[] = [];
    createAgentRuntimeMock
      .mockReturnValueOnce(
        makeRuntime({
          listModels: vi.fn<AgentRuntime["listModels"]>().mockResolvedValue({
            models: [makeModel({ id: "first" })],
            selectedOnlyModels: [],
          }),
          shutdown: async () => {
            shutdowns.push("first");
          },
        }),
      )
      .mockReturnValueOnce(
        makeRuntime({
          listModels: vi.fn<AgentRuntime["listModels"]>().mockResolvedValue({
            models: [makeModel({ id: "second" })],
            selectedOnlyModels: [],
          }),
          shutdown: async () => {
            shutdowns.push("second");
          },
        }),
      );

    await expect(
      defaultListModels({
        providerId: "acp-custom",
        acpLaunchSpec: firstSpec,
        bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
      }),
    ).resolves.toMatchObject({ models: [{ id: "first" }] });
    await expect(
      defaultListModels({
        providerId: "acp-custom",
        acpLaunchSpec: secondSpec,
        bridgeLaunch: DISPATCH_TEST_RUNTIME_BRIDGE_LAUNCH,
      }),
    ).resolves.toMatchObject({ models: [{ id: "second" }] });

    expect(createAgentRuntimeMock).toHaveBeenCalledTimes(2);
    await shutdownDefaultListModelsRuntimes();
    expect(shutdowns).toEqual(["first", "second"]);
  });
});
