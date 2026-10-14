// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusWithKeyboard } from "@/test/keyboard-focus";
import {
  hostsQueryKey,
  systemMachineProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import { makeEnvironment, makeThread } from "@bb/test-helpers/domain-fixtures";
import { EnvironmentRow, ThreadMetadataCard } from "./ThreadMetadataContent";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ThreadMetadataCard", () => {
  it("shows its scrollbar only during active scrolling", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ThreadMetadataCard>
        <div>Thread information</div>
      </ThreadMetadataCard>,
    );
    const scrollArea = container.querySelector("dl");
    if (!(scrollArea instanceof HTMLElement)) {
      throw new Error("missing info scroll area");
    }

    expect(scrollArea.classList).toContain("transient-scrollbar");
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);

    fireEvent.scroll(scrollArea);
    expect(scrollArea.dataset.scrollbarScrolling).toBe("true");

    act(() => vi.advanceTimersByTime(599));
    expect(scrollArea.dataset.scrollbarScrolling).toBe("true");

    act(() => vi.advanceTimersByTime(1));
    expect(scrollArea.hasAttribute("data-scrollbar-scrolling")).toBe(false);
  });
});

describe("EnvironmentRow", () => {
  it("explains the create-thread action in a tooltip", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(hostsQueryKey(), []);
    queryClient.setQueryData(systemMachineProvidersQueryKey(), []);
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <MemoryRouter>
            <EnvironmentRow
              thread={makeThread()}
              environment={makeEnvironment()}
              environmentDisplayHost={{ locality: "local", identity: null }}
            />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );

    focusWithKeyboard(
      screen.getByRole("button", {
        name: "New thread in environment",
      }),
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "New thread in environment",
    );
  });
});
