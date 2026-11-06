// @vitest-environment jsdom
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { BbHttpError } from "@bb/sdk/browser";
import type { SystemProviderState } from "@bb/server-contract";
import { useCallback, type ReactNode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import {
  useAgentSignIns,
  type AgentSignInTerminals,
  type RefetchProviderStates,
} from "./useAgentSignIns";

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
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
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
    (props: { states: SystemProviderState[]; statesSettledAt: number }) =>
      useAgentSignIns({
        redesign: concurrent,
        entry: "first_run",
        hostId,
        states: props.states,
        statesSettledAt: props.statesSettledAt,
        isLocalHost: () => true,
        terminals,
        refetchStates,
      }),
    { initialProps: { states, statesSettledAt: 0 } },
  );
  return { ...view, terminals, refetchStates };
}

function settledAfterNow(): number {
  return Date.now() + 1;
}

function recordedOutcomes(): unknown[] {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.flatMap(([event]) =>
      event.name === "onboarding_sign_in" ? [event.properties.outcome] : [],
    );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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
      statesSettledAt: 0,
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
    const states = [provider("codex"), provider("claude-code")];
    const { result, rerender } = renderSignIns(true, states);
    await act(async () => {
      await result.current.start("codex");
    });
    act(() => result.current.handleExit("codex", 1));
    rerender({ states, statesSettledAt: settledAfterNow() });

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
      const states = [provider("codex"), provider("claude-code")];
      const { result, rerender } = renderSignIns(concurrent, states);
      await act(async () => {
        await result.current.start("codex");
      });
      act(() => result.current.handleExit("codex", 1));
      rerender({ states, statesSettledAt: settledAfterNow() });

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

  it("shows the failed state when the sign-in exits cleanly before the agent is ready", async () => {
    const states = [provider("pi")];
    const { result, rerender, terminals, refetchStates } = renderSignIns(
      true,
      states,
    );
    await act(async () => {
      await result.current.start("pi");
    });

    act(() => result.current.handleExit("pi", 0));
    act(() => result.current.handleExit("pi", 0));
    expect(result.current.signIns.has("pi")).toBe(true);
    expect(result.current.failedProviderIds.size).toBe(0);
    expect(refetchStates).toHaveBeenCalledTimes(1);

    rerender({ states, statesSettledAt: 0 });
    expect(result.current.signIns.has("pi")).toBe(true);

    rerender({ states, statesSettledAt: settledAfterNow() });
    expect(result.current.signIns.size).toBe(0);
    expect([...result.current.failedProviderIds]).toEqual(["pi"]);
    expect(terminals.close).toHaveBeenCalledExactlyOnceWith("term_1");
  });

  it("ends as ready when the agent is ready once its sign-in exits", async () => {
    const { result, rerender } = renderSignIns(true, [provider("codex")]);
    await act(async () => {
      await result.current.start("codex");
    });

    act(() => result.current.handleExit("codex", 0));
    rerender({
      states: [provider("codex", { status: "ready" })],
      statesSettledAt: settledAfterNow(),
    });

    expect(result.current.signIns.size).toBe(0);
    expect(result.current.failedProviderIds.size).toBe(0);
    expect(recordedOutcomes()).toEqual(["started", "ready"]);
  });

  it("shows no failure when the user cancels with X as the sign-in exits", async () => {
    const states = [provider("codex")];
    const { result, rerender } = renderSignIns(true, states);
    await act(async () => {
      await result.current.start("codex");
    });

    act(() => result.current.handleExit("codex", 0));
    act(() => result.current.end("codex"));
    rerender({ states, statesSettledAt: settledAfterNow() });

    expect(result.current.signIns.size).toBe(0);
    expect(result.current.failedProviderIds.size).toBe(0);
    expect(recordedOutcomes()).toEqual(["started", "cancelled"]);
  });

  describe.each([
    ["the redesign", true],
    ["today's guide", false],
  ] as const)("an exited sign-in in %s", (_variant, redesign) => {
    it.each([
      [0, true, "ready"],
      [1, true, "ready"],
      [null, true, "ready"],
      [0, false, "exited"],
      [1, false, "failed"],
      [null, false, "failed"],
    ] as const)(
      "exiting with %s when the agent is ready=%s records %s once a fresh state lands",
      async (exitCode, ready, outcome) => {
        const { result, rerender } = renderSignIns(redesign, [
          provider("codex"),
        ]);
        await act(async () => {
          await result.current.start("codex");
        });

        act(() => result.current.handleExit("codex", exitCode));
        expect(recordedOutcomes()).toEqual(["started"]);
        rerender({
          states: [provider("codex", ready ? { status: "ready" } : {})],
          statesSettledAt: settledAfterNow(),
        });

        expect(recordedOutcomes()).toEqual(["started", outcome]);
      },
    );
  });

  it("keeps today's failed row after a non-zero exit even when the agent turns out ready", async () => {
    const { result, rerender } = renderSignIns(false, [provider("codex")]);
    await act(async () => {
      await result.current.start("codex");
    });

    act(() => result.current.handleExit("codex", 1));
    expect(result.current.signIns.size).toBe(0);
    expect([...result.current.failedProviderIds]).toEqual(["codex"]);
    rerender({
      states: [provider("codex", { status: "ready" })],
      statesSettledAt: settledAfterNow(),
    });

    expect([...result.current.failedProviderIds]).toEqual(["codex"]);
    expect(recordedOutcomes()).toEqual(["started", "ready"]);
  });

  it.each([
    ["the redesign", true, false],
    ["today's guide, as on main", false, true],
  ] as const)(
    "polls provider states while signing in, in %s",
    async (_variant, redesign, cancelRefetch) => {
      vi.useFakeTimers();
      const { result, refetchStates } = renderSignIns(redesign);
      await act(async () => {
        await result.current.start("codex");
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(refetchStates).toHaveBeenCalledExactlyOnceWith({ cancelRefetch });
    },
  );

  it("settles an exited sign-in on one slow provider-states response without aborting it", async () => {
    vi.useFakeTimers();
    notifyManager.setScheduler((callback) => callback());
    onTestFinished(() => notifyManager.setScheduler(defaultScheduler));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const server = { ready: false, fetches: 0, aborts: 0 };
    const terminals = fakeTerminals();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        const query = useQuery({
          queryKey: ["provider-states"],
          queryFn: ({ signal }) => {
            server.fetches += 1;
            const ready = server.ready;
            signal.addEventListener("abort", () => {
              server.aborts += 1;
            });
            return new Promise<SystemProviderState[]>((resolve) => {
              setTimeout(
                () =>
                  resolve([
                    provider("codex", ready ? { status: "ready" } : {}),
                  ]),
                5_000,
              );
            });
          },
        });
        const { refetch } = query;
        const refetchStates = useCallback<RefetchProviderStates>(
          (options) => {
            void refetch(options);
          },
          [refetch],
        );
        return useAgentSignIns({
          redesign: true,
          entry: "first_run",
          hostId: "host_1",
          states: query.data,
          statesSettledAt: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
          isLocalHost: () => true,
          terminals,
          refetchStates,
        });
      },
      { wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(server.fetches).toBe(1);
    expect(result.current.signIns.size).toBe(0);
    await act(async () => {
      await result.current.start("codex");
    });
    const fetchesBeforeExit = server.fetches;

    server.ready = true;
    act(() => result.current.handleExit("codex", 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(result.current.signIns.size).toBe(0);
    expect(recordedOutcomes()).toEqual(["started", "ready"]);
    expect(server.aborts).toBe(0);
    expect(server.fetches).toBe(fetchesBeforeExit + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(server.fetches).toBe(fetchesBeforeExit + 1);
    queryClient.clear();
  });

  it("keeps today's quiet return to Sign in after a clean exit in the control guide", async () => {
    const { result } = renderSignIns(false);
    await act(async () => {
      await result.current.start("codex");
    });

    act(() => result.current.handleExit("codex", 0));

    expect(result.current.signIns.size).toBe(0);
    expect(result.current.failedProviderIds.size).toBe(0);
  });
});
