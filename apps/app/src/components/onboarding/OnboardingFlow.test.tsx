// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { toast } from "sonner";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { AppToasterView } from "@/components/AppToasterView";
import { appToast } from "@/components/ui/app-toast";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import { hostsQueryOptions } from "@/hooks/queries/host-queries";
import { pluginCatalogSearchQueryKey } from "@/hooks/queries/query-keys";
import type { OnboardingStepId } from "./onboarding-model";
import { recordTelemetryEvent } from "./onboarding-telemetry";
import { OnboardingFlow } from "./OnboardingFlow";

const sdkCalls = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/sdk", () => ({
  sdk: new Proxy(
    {},
    {
      get: (_sdk, area) =>
        new Proxy(
          {},
          {
            get: (_area, method) => () => {
              sdkCalls.push(`${String(area)}.${String(method)}`);
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
  router.navigate = useNavigate();
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

function renderFlow({
  initialStep,
  onClose = vi.fn(),
  variant = "new",
}: {
  initialStep: OnboardingStepId;
  onClose?: () => void;
  variant?: "control" | "new";
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(hostsQueryOptions(false).queryKey, [
    makeHost({ id: "host_1", name: "bee" }),
  ]);
  const flow = (closing: boolean) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NavigateProbe />
        <TooltipProvider>
          <OnboardingFlow
            initialStep={initialStep}
            entry="first_run"
            setupGuide={{ variant }}
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

  it.each([
    ["control", false],
    ["new", true],
  ] as const)(
    "prefetches the plugin catalog when the guide opens only in the new guide (%s)",
    (variant, prefetched) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<never>(() => {})),
      );
      onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const { queryClient } = renderFlow({ initialStep: "agent", variant });

      expect(
        queryClient.getQueryState(pluginCatalogSearchQueryKey("")) !==
          undefined,
      ).toBe(prefetched);
    },
  );

  it("offers Retry and Continue when the agent check never answers", () => {
    vi.useFakeTimers();
    renderFlow({ initialStep: "agent" });

    expect(button(/Continue/u).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(
      screen.getByText("Provider readiness could not be checked."),
    ).toBeTruthy();
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
    expect(agentLoadFailures()).toEqual(["timed_out", "timed_out"]);
  });

  it.each([
    ["new", "narrow window", "bottom-right"],
    ["new", "phone", "top-center"],
    ["control", "narrow window", "top-center"],
  ] as const)(
    "shows toasts for a %s guide on a %s at %s",
    async (variant, viewport, placement) => {
      stubViewport(viewport);
      render(<AppToasterView />);
      renderFlow({ initialStep: "plugins", variant });

      expect(await toasterPlacement()).toBe(placement);
    },
  );

  it("returns toasts to the app's narrow-window placement once the new guide closes", async () => {
    stubViewport("narrow window");
    render(<AppToasterView />);
    const { unmount } = renderFlow({ initialStep: "plugins" });
    expect(await toasterPlacement()).toBe("bottom-right");

    unmount();

    expect(await toasterPlacement()).toBe("top-center");
  });
});
