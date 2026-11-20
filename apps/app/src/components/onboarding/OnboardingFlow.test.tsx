// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { BbRequestTimeoutError } from "@bb/sdk/browser";
import {
  MemoryRouter,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { useLayoutEffect } from "react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { toast } from "sonner";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { AppToasterView } from "@/components/AppToasterView";
import { appToast } from "@/components/ui/app-toast";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import { hostsQueryOptions } from "@/hooks/queries/host-queries";
import {
  hostProviderStateQueryKey,
  pluginCatalogSearchQueryKey,
  systemProviderCatalogQueryKey,
  systemProviderStatesQueryKey,
} from "@/hooks/queries/query-keys";
import type {
  SystemProviderCatalogEntry,
  SystemProviderState,
} from "@bb/server-contract";
import type { OnboardingStepId } from "./onboarding-model";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { OnboardingFlow } from "./OnboardingFlow";

const sdkCalls = vi.hoisted(() => [] as string[]);
const providerStateAnswers = vi.hoisted(
  () => new Map<string, () => Promise<unknown>>(),
);
const providerStateCalls = vi.hoisted(() => [] as (string | undefined)[]);

vi.mock("@/lib/sdk", () => ({
  sdk: new Proxy(
    {},
    {
      get: (_sdk, area) =>
        new Proxy(
          {},
          {
            get: (_area, method) => (args?: { providerId?: string }) => {
              const call = `${String(area)}.${String(method)}`;
              sdkCalls.push(call);
              if (call === "system.providerStates") {
                providerStateCalls.push(args?.providerId);
                const answer = providerStateAnswers.get(args?.providerId ?? "");
                if (answer !== undefined) return answer();
              }
              return new Promise<never>(() => {});
            },
          },
        ),
    },
  ),
}));
vi.mock("@/hooks/useRealtimeSubscription", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.keys(actual).map((name) => [name, () => undefined]),
  );
});
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));

const router: { navigate: NavigateFunction | null } = { navigate: null };

function NavigateProbe() {
  const navigate = useNavigate();
  useLayoutEffect(() => {
    router.navigate = navigate;
  });
  return null;
}

function finishedOutcomes(): unknown[] {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.flatMap(([event]) =>
      event.name === "onboarding_finished" ? [event.properties.outcome] : [],
    );
}

function agentLoadFailures(): unknown[] {
  return vi
    .mocked(recordTelemetryEvent)
    .mock.calls.flatMap(([event]) =>
      event.name === "onboarding_operation" &&
      event.properties.step === "agent" &&
      event.properties.operation === "load"
        ? [event.properties.failure_reason]
        : [],
    );
}

function catalogEntry(id: string): SystemProviderCatalogEntry {
  return {
    id,
    displayName: id === "claude-code" ? "Claude Code" : "Codex",
    pluginId: `provider-${id}`,
    pluginName: id,
    pluginEnabled: true,
    enabled: true,
    available: true,
    logoUrl: null,
    info: null,
  };
}

function providerState(
  providerId: string,
  overrides: Partial<SystemProviderState> = {},
): SystemProviderState {
  return {
    providerId,
    displayName: providerId === "claude-code" ? "Claude Code" : "Codex",
    status: "ready",
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: "2.1.0",
    minimumSupportedVersion: null,
    canInstall: true,
    canUpdate: true,
    loginCommand: "claude auth login",
    localLoginCommand: null,
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
    ...overrides,
  };
}

function renderFlow({
  initialStep,
  onClose = vi.fn(),
  catalog,
  cachedStates,
  hostStatus = "connected",
}: {
  initialStep: OnboardingStepId;
  onClose?: () => void;
  catalog?: string[];
  cachedStates?: SystemProviderState[];
  hostStatus?: "connected" | "disconnected";
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(hostsQueryOptions(false).queryKey, [
    makeHost({ id: "host_1", name: "bee", status: hostStatus }),
  ]);
  if (catalog !== undefined) {
    queryClient.setQueryData(
      systemProviderCatalogQueryKey(),
      catalog.map(catalogEntry),
    );
  }
  if (cachedStates !== undefined) {
    queryClient.setQueryData(
      systemProviderStatesQueryKey({ environmentId: null, hostId: "host_1" }),
      { providers: cachedStates },
    );
  }
  const flow = (closing: boolean) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NavigateProbe />
        <TooltipProvider>
          <OnboardingFlow
            initialStep={initialStep}
            entry="first_run"
            closing={closing}
            onClose={onClose}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(flow(false));
  return {
    queryClient,
    setClosing: (closing: boolean) => view.rerender(flow(closing)),
    unmount: view.unmount,
  };
}

function agentRow(id: string): HTMLElement {
  const row = document.querySelector(`[data-agent-id="${id}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`No row for ${id}`);
  return row;
}

function button(name: RegExp): HTMLButtonElement {
  const element = screen.getByRole("button", { name });
  if (!(element instanceof HTMLButtonElement)) throw new Error("Not a button");
  return element;
}

type Viewport = "desktop" | "narrow window" | "phone";

function stubViewport(viewport: Viewport): void {
  const spy = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query: string) => ({
      matches:
        (viewport !== "desktop" && query === "(max-width: 767px)") ||
        (viewport === "phone" &&
          query === "(max-width: 640px) and (pointer: coarse)"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
  onTestFinished(() => spy.mockRestore());
}

async function toasterPlacement(): Promise<string> {
  act(() => {
    appToast.success("Plugin installed", {
      duration: Number.POSITIVE_INFINITY,
    });
  });
  return waitFor(() => {
    const toaster = document.querySelector<HTMLElement>(
      "[data-sonner-toaster]",
    );
    if (toaster === null) throw new Error("No toaster");
    if (!toaster.textContent?.includes("Plugin installed")) {
      throw new Error("Toast not rendered in the toaster");
    }
    expect(Number(toaster.style.zIndex)).toBe(APP_OVERLAY_LAYER.toast);
    return `${toaster.dataset.yPosition}-${toaster.dataset.xPosition}`;
  });
}

function providerStateRequests(): number {
  return sdkCalls.filter((call) => call === "system.providerStates").length;
}

afterEach(() => {
  toast.dismiss();
  cleanup();
  vi.clearAllMocks();
  router.navigate = null;
  vi.useRealTimers();
  sdkCalls.length = 0;
  providerStateAnswers.clear();
  providerStateCalls.length = 0;
});

describe("OnboardingFlow", () => {
  it("keeps the guide on its last step when the user navigates while a failing Finish save is pending", () => {
    const onClose = vi.fn();
    const { setClosing } = renderFlow({ initialStep: "devices", onClose });

    fireEvent.click(button(/Start using bb/u));
    fireEvent.click(button(/Start using bb/u));
    expect(onClose).toHaveBeenCalledTimes(1);
    setClosing(true);
    act(() => {
      void router.navigate?.("/threads/thr_1");
    });
    setClosing(false);
    setClosing(false);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(finishedOutcomes()).toEqual(["completed"]);
    button(/Start using bb/u);
    fireEvent.click(button(/Start using bb/u));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(finishedOutcomes()).toEqual(["completed", "completed"]);
  });

  it("still closes the open guide as skipped when the user navigates away", () => {
    const onClose = vi.fn();
    renderFlow({ initialStep: "devices", onClose });

    act(() => {
      void router.navigate?.("/threads/thr_1");
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(finishedOutcomes()).toEqual(["skipped"]);
  });

  it("prefetches the plugin catalog when the guide opens", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<never>(() => {})),
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const { queryClient } = renderFlow({ initialStep: "agent" });

    expect(
      queryClient.getQueryState(pluginCatalogSearchQueryKey("")),
    ).toBeDefined();
  });

  it("offers Retry and Continue when the agent check never answers", () => {
    vi.useFakeTimers();
    renderFlow({ initialStep: "agent" });

    expect(button(/Continue/u).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByText("Couldn't load agents")).toBeTruthy();
    expect(button(/Continue/u).disabled).toBe(false);
    expect(agentLoadFailures()).toEqual(["timed_out"]);

    const requestsBeforeRetry = providerStateRequests();
    fireEvent.click(button(/^Retry$/u));
    expect(providerStateRequests()).toBe(requestsBeforeRetry + 1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(button(/Continue/u).disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(button(/^Retry$/u)).toBeTruthy();
    expect(button(/Continue/u).disabled).toBe(false);
    expect(agentLoadFailures()).toEqual(["timed_out"]);
  });

  it("keeps showing agents whose checks answered while slower checks are still running", () => {
    vi.useFakeTimers();
    const { queryClient } = renderFlow({ initialStep: "agent" });
    act(() => {
      queryClient.setQueryData(
        hostProviderStateQueryKey({
          hostId: "host_1",
          providerId: "claude-code",
        }),
        { providers: [providerState("claude-code")] },
      );
      queryClient.setQueryData(systemProviderCatalogQueryKey(), [
        catalogEntry("claude-code"),
        catalogEntry("codex"),
      ]);
    });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.queryByText("Couldn't load agents")).toBeNull();
    expect(agentLoadFailures()).toEqual([]);
  });

  it("shows one agent whose check failed as its own row and rechecks only that agent", async () => {
    providerStateAnswers.set("claude-code", () =>
      Promise.resolve({ providers: [providerState("claude-code")] }),
    );
    providerStateAnswers.set("codex", () =>
      Promise.reject(new BbRequestTimeoutError(75_000)),
    );
    renderFlow({ initialStep: "agent", catalog: ["claude-code", "codex"] });

    const codexRow = await waitFor(() => agentRow("codex"));
    expect(within(codexRow).getByText("Didn't respond in time.")).toBeTruthy();
    expect(within(agentRow("claude-code")).getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("Couldn't load agents")).toBeNull();

    const callsBeforeRetry = providerStateCalls.length;
    providerStateAnswers.set("codex", () =>
      Promise.resolve({ providers: [providerState("codex")] }),
    );
    fireEvent.click(within(codexRow).getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(within(agentRow("codex")).getByText("Ready")).toBeTruthy(),
    );
    expect(providerStateCalls.slice(callsBeforeRetry)).toEqual(["codex"]);
  });

  it("lets an agent the cached list could not check be retried on its own", async () => {
    renderFlow({
      initialStep: "agent",
      catalog: ["claude-code", "codex"],
      cachedStates: [
        providerState("claude-code"),
        providerState("codex", {
          status: "unknown",
          statusMessage: "Could not determine the codex version.",
        }),
      ],
    });
    providerStateAnswers.set("codex", () =>
      Promise.resolve({ providers: [providerState("codex")] }),
    );

    const codexRow = await waitFor(() => agentRow("codex"));
    expect(within(codexRow).getByText("Couldn't load agent")).toBeTruthy();
    fireEvent.click(
      within(codexRow).getByRole("button", { name: /Show details/u }),
    );
    expect(
      within(codexRow).getByText("Could not determine the codex version."),
    ).toBeTruthy();
    const retry = within(codexRow).getByRole("button", { name: "Retry" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);

    const callsBeforeRetry = providerStateCalls.length;
    fireEvent.click(retry);

    await waitFor(() =>
      expect(within(agentRow("codex")).getByText("Ready")).toBeTruthy(),
    );
    expect(providerStateCalls.slice(callsBeforeRetry)).toEqual(["codex"]);
  });

  it("lets the list be retried when an offline machine's cached agents all failed", async () => {
    renderFlow({
      initialStep: "agent",
      catalog: ["claude-code", "codex"],
      hostStatus: "disconnected",
      cachedStates: [
        providerState("claude-code", { status: "unknown" }),
        providerState("codex", { status: "unknown" }),
      ],
    });

    expect(
      await screen.findByText(
        "Can't reach bee. Make sure bb is running there, then retry.",
      ),
    ).toBeTruthy();
    const retry = button(/^Retry$/u);
    expect(retry.disabled).toBe(false);

    const callsBeforeRetry = providerStateCalls.length;
    fireEvent.click(retry);

    await waitFor(() =>
      expect(providerStateCalls.slice(callsBeforeRetry).sort()).toEqual([
        "claude-code",
        "codex",
      ]),
    );
  });

  it("says an agent couldn't load when its check fails for another reason", async () => {
    providerStateAnswers.set("claude-code", () =>
      Promise.resolve({ providers: [providerState("claude-code")] }),
    );
    providerStateAnswers.set("codex", () => Promise.reject(new Error("boom")));
    renderFlow({ initialStep: "agent", catalog: ["claude-code", "codex"] });

    const codexRow = await waitFor(() => agentRow("codex"));
    expect(within(codexRow).getByText("Couldn't load agent")).toBeTruthy();
    expect(
      within(codexRow).getByRole("button", { name: "Retry" }),
    ).toBeTruthy();
  });

  it("shows one list-wide failure when every check failed, and Retry rechecks just those agents", async () => {
    providerStateAnswers.set("", () => Promise.reject(new Error("boom")));
    providerStateAnswers.set("claude-code", () =>
      Promise.reject(new Error("boom")),
    );
    providerStateAnswers.set("codex", () => Promise.reject(new Error("boom")));
    renderFlow({ initialStep: "agent", catalog: ["claude-code", "codex"] });

    expect(await screen.findByText("Couldn't load agents")).toBeTruthy();
    expect(screen.queryByText("Couldn't load agent")).toBeNull();

    const callsBeforeRetry = providerStateCalls.length;
    fireEvent.click(button(/^Retry$/u));

    await waitFor(() =>
      expect(providerStateCalls.slice(callsBeforeRetry).sort()).toEqual([
        "claude-code",
        "codex",
      ]),
    );
  });

  it.each([
    ["narrow window", "bottom-right"],
    ["phone", "top-center"],
  ] as const)("shows toasts on a %s at %s", async (viewport, placement) => {
    stubViewport(viewport);
    render(<AppToasterView />);
    renderFlow({ initialStep: "plugins" });

    expect(await toasterPlacement()).toBe(placement);
  });

  it("returns toasts to the app's narrow-window placement once the guide closes", async () => {
    stubViewport("narrow window");
    render(<AppToasterView />);
    const { unmount } = renderFlow({ initialStep: "plugins" });
    expect(await toasterPlacement()).toBe("bottom-right");

    unmount();

    expect(await toasterPlacement()).toBe("top-center");
  });
});
