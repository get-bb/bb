// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostsQueryOptions } from "@/hooks/queries/host-queries";
import type { OnboardingStepId } from "./onboarding-model";
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

function renderFlow({
  initialStep,
  onClose = vi.fn(),
}: {
  initialStep: OnboardingStepId;
  onClose?: () => void;
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
        <TooltipProvider>
          <OnboardingFlow
            initialStep={initialStep}
            entry="first_run"
            setupGuide={{ variant: "new", featuredPluginEntryIds: null }}
            closing={closing}
            onClose={onClose}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(flow(false));
  return { setClosing: (closing: boolean) => view.rerender(flow(closing)) };
}

function button(name: RegExp): HTMLButtonElement {
  const element = screen.getByRole("button", { name });
  if (!(element instanceof HTMLButtonElement)) throw new Error("Not a button");
  return element;
}

function providerStateRequests(): number {
  return sdkCalls.filter((call) => call === "system.providerStates").length;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sdkCalls.length = 0;
});

describe("OnboardingFlow", () => {
  it("lets Start using bb finish again after the close it started was undone", () => {
    const onClose = vi.fn();
    const { setClosing } = renderFlow({ initialStep: "devices", onClose });

    fireEvent.click(button(/Start using bb/u));
    fireEvent.click(button(/Start using bb/u));
    expect(onClose).toHaveBeenCalledTimes(1);

    setClosing(true);
    setClosing(false);
    fireEvent.click(button(/Start using bb/u));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

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
  });
});
