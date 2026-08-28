// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopCloseWindowRequestHandler } from "@bb/desktop-contract";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { RootComposePanelCommandHandlers } from "./RootComposePanelCommandHandlers";

const commandFixture = vi.hoisted(() => ({
  keybindings: [
    {
      command: "panel.toggle" as const,
      desktopOnly: false,
      shortcut: {
        key: "p",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "panel.close" as const,
      desktopOnly: false,
      shortcut: {
        key: "w",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
  ],
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function dispatchControlShortcut(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key,
  });
  fireEvent(window, event);
  return event;
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

describe("RootComposePanelCommandHandlers", () => {
  it("routes panel shortcuts and desktop close requests only to the focused New Thread pane", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(
      systemConfigQueryKey(),
      makeSystemConfig({ keybindings: commandFixture.keybindings }),
    );
    const firstToggle = vi.fn();
    const firstClose = vi.fn(() => true);
    const secondToggle = vi.fn();
    const secondClose = vi.fn(() => true);
    const desktopCloseHandlers = new Set<BbDesktopCloseWindowRequestHandler>();
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      onCloseWindowRequest(listener) {
        desktopCloseHandlers.add(listener);
        return () => desktopCloseHandlers.delete(listener);
      },
    };

    const view = render(
      <QueryClientProvider client={queryClient}>
        <AppCommandProvider>
          <RootComposePanelCommandHandlers
            isFocused
            onClose={firstClose}
            onToggle={firstToggle}
          />
          <RootComposePanelCommandHandlers
            isFocused={false}
            onClose={secondClose}
            onToggle={secondToggle}
          />
        </AppCommandProvider>
      </QueryClientProvider>,
    );

    await act(async () => undefined);
    expect(desktopCloseHandlers.size).toBe(1);
    expect(dispatchControlShortcut("p").defaultPrevented).toBe(true);
    expect(firstToggle).toHaveBeenCalledTimes(1);
    expect(secondToggle).not.toHaveBeenCalled();
    expect(dispatchControlShortcut("w").defaultPrevented).toBe(true);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();
    for (const handler of desktopCloseHandlers) {
      expect(handler()).toBe(true);
    }
    expect(firstClose).toHaveBeenCalledTimes(2);

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AppCommandProvider>
          <RootComposePanelCommandHandlers
            isFocused={false}
            onClose={firstClose}
            onToggle={firstToggle}
          />
          <RootComposePanelCommandHandlers
            isFocused
            onClose={secondClose}
            onToggle={secondToggle}
          />
        </AppCommandProvider>
      </QueryClientProvider>,
    );
    await act(async () => undefined);

    expect(desktopCloseHandlers.size).toBe(1);
    dispatchControlShortcut("p");
    dispatchControlShortcut("w");
    expect(firstToggle).toHaveBeenCalledTimes(1);
    expect(firstClose).toHaveBeenCalledTimes(2);
    expect(secondToggle).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
    for (const handler of desktopCloseHandlers) handler();
    expect(secondClose).toHaveBeenCalledTimes(2);
  });
});
