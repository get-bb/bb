// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import type { SystemProviderState } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { useAgentSignIns, type AgentSignInTerminals } from "./useAgentSignIns";

vi.mock("./onboarding-telemetry", () => ({
  recordTelemetryEvent: vi.fn(),
}));

function provider(
  providerId: string,
  overrides: Partial<SystemProviderState> = {},
): SystemProviderState {
  return {
    providerId,
    displayName: providerId,
    status: "unauthenticated",
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: "1.0.0",
    minimumSupportedVersion: null,
    canInstall: true,
    canUpdate: true,
    loginCommand: `${providerId} login`,
    localLoginCommand: null,
    ...overrides,
  };
}

function fakeTerminals() {
  let next = 0;
  const terminals: AgentSignInTerminals = {
    closeAbandoned: vi.fn(async () => {}),
    create: vi.fn(async () => {
      next += 1;
      return makeTerminalSession({ id: `term_${next}` });
    }),
    close: vi.fn(),
  };
  return terminals;
}

function renderSignIns(
  concurrent: boolean,
  states: SystemProviderState[] = [provider("codex"), provider("claude-code")],
  hostId: string | null = "host_1",
) {
  const terminals = fakeTerminals();
  const refetchStates = vi.fn();
  const view = renderHook(
    (props: { states: SystemProviderState[] }) =>
      useAgentSignIns({
        concurrent,
        entry: "first_run",
        hostId,
        states: props.states,
        isLocalHost: () => true,
        terminals,
        refetchStates,
      }),
    { initialProps: { states } },
  );
  return { ...view, terminals };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAgentSignIns", () => {
  it("keeps two sign-ins open at once and cancels only the one asked for", async () => {
    const { result, terminals } = renderSignIns(true);

    await act(async () => {
      await result.current.start("codex");
      await result.current.start("claude-code");
    });
    expect([...result.current.signIns.keys()]).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(terminals.close).not.toHaveBeenCalled();

    act(() => result.current.end("codex"));
    expect([...result.current.signIns.keys()]).toEqual(["claude-code"]);
    expect(terminals.close).toHaveBeenCalledExactlyOnceWith("term_1");
  });

  it("starts a second sign-in while the first is still creating its terminal", async () => {
    const { result, terminals } = renderSignIns(true);
    let finishFirst: (() => void) | undefined;
    vi.mocked(terminals.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(makeTerminalSession({ id: "slow" }));
        }),
    );

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.start("codex");
    });
    await act(async () => {
      await result.current.start("claude-code");
    });
    expect(result.current.startingProviderIds.has("codex")).toBe(true);
    await act(async () => {
      finishFirst?.();
      await first;
    });

    expect([...result.current.signIns.keys()].sort()).toEqual([
      "claude-code",
      "codex",
    ]);
    expect(result.current.startingProviderIds.size).toBe(0);
    expect(terminals.close).not.toHaveBeenCalled();
  });

  it("cancels a sign-in whose terminal is still being created", async () => {
    const { result, terminals } = renderSignIns(true);
    let finish: (() => void) | undefined;
    vi.mocked(terminals.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(makeTerminalSession({ id: "slow" }));
        }),
    );
    let starting: Promise<void> | undefined;
    act(() => {
      starting = result.current.start("codex");
    });
    await act(async () => {});
    expect(result.current.startingProviderIds.has("codex")).toBe(true);

    act(() => result.current.end("codex"));
    expect(result.current.startingProviderIds.has("codex")).toBe(false);
    await act(async () => {
      finish?.();
      await starting;
    });

    expect(result.current.signIns.size).toBe(0);
    expect(terminals.close).toHaveBeenCalledExactlyOnceWith("slow");
  });

  it("ends only the sign-in whose agent became ready", async () => {
    const { result, rerender, terminals } = renderSignIns(true);
    await act(async () => {
      await result.current.start("codex");
      await result.current.start("claude-code");
    });

    rerender({
      states: [provider("codex", { status: "ready" }), provider("claude-code")],
    });

    expect([...result.current.signIns.keys()]).toEqual(["claude-code"]);
    expect(terminals.close).toHaveBeenCalledExactlyOnceWith("term_1");
  });

  it("ends a sign-in whose agent reported a failure while still running", async () => {
    const { result, terminals } = renderSignIns(true, [provider("pi")]);
    await act(async () => {
      await result.current.start("pi");
    });

    act(() => result.current.fail("pi"));

    expect(result.current.signIns.size).toBe(0);
    expect(result.current.failedProviderIds.has("pi")).toBe(true);
    expect(terminals.close).toHaveBeenCalledExactlyOnceWith("term_1");
  });

  it("keeps today's one-at-a-time sign-in in the control guide", async () => {
    const { result, terminals } = renderSignIns(false);

    await act(async () => {
      await result.current.start("codex");
      await result.current.start("claude-code");
    });

    expect([...result.current.signIns.keys()]).toEqual(["claude-code"]);
    expect(terminals.close).toHaveBeenCalledExactlyOnceWith("term_1");
  });

  it("clears every failed sign-in when the control guide starts another", async () => {
    const { result } = renderSignIns(false);
    await act(async () => {
      await result.current.start("codex");
    });
    act(() => result.current.handleExit("codex", 1));
    expect(result.current.failedProviderIds.has("codex")).toBe(true);

    await act(async () => {
      await result.current.start("claude-code");
    });
    expect(result.current.failedProviderIds.size).toBe(0);
  });

  it("keeps another agent's failed sign-in in the redesign", async () => {
    const { result } = renderSignIns(true);
    await act(async () => {
      await result.current.start("codex");
    });
    act(() => result.current.handleExit("codex", 1));

    await act(async () => {
      await result.current.start("claude-code");
    });
    expect([...result.current.failedProviderIds]).toEqual(["codex"]);
  });

  describe.each([
    ["the redesign", true],
    ["today's guide", false],
  ] as const)("telemetry in %s", (_variant, concurrent) => {
    function recorded() {
      return vi
        .mocked(recordTelemetryEvent)
        .mock.calls.map(([event]) => event.properties);
    }

    it("names the agent and records a non-zero exit as a failed command", async () => {
      const { result } = renderSignIns(concurrent);
      await act(async () => {
        await result.current.start("codex");
      });
      act(() => result.current.handleExit("codex", 1));

      expect(recorded()).toEqual([
        { entry: "first_run", outcome: "started", resource_id: "codex" },
        {
          entry: "first_run",
          outcome: "failed",
          resource_id: "codex",
          failure_reason: "command_failed",
        },
      ]);
    });

    it("records why the sign-in terminal could not be created", async () => {
      const { result, terminals } = renderSignIns(concurrent);
      vi.mocked(terminals.create).mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: "host_unavailable",
          message: "Host is not connected",
          status: 502,
        }),
      );
      await act(async () => {
        await result.current.start("codex");
      });

      expect(recorded()).toEqual([
        { entry: "first_run", outcome: "started", resource_id: "codex" },
        {
          entry: "first_run",
          outcome: "failed",
          resource_id: "codex",
          failure_reason: "host_unavailable",
        },
      ]);
    });

    it.each([
      ["no_host", null, [provider("codex")]],
      ["not_found", "host_1", []],
      ["unsupported", "host_1", [provider("codex", { loginCommand: null })]],
    ] as const)(
      "records a sign-in that could not start as %s",
      async (failureReason, hostId, states) => {
        const { result, terminals } = renderSignIns(
          concurrent,
          [...states],
          hostId,
        );
        await act(async () => {
          await result.current.start("codex");
        });

        expect(terminals.create).not.toHaveBeenCalled();
        expect(recorded()).toEqual([
          {
            entry: "first_run",
            outcome: "failed",
            resource_id: "codex",
            failure_reason: failureReason,
          },
        ]);
      },
    );
  });
});
