// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { PluginThreadList } from "./PluginThreadList";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/components/ui/app-toast", () => ({ appToast: toast }));

function pluginReplacement(
  component: (props: PluginThreadListProps) => React.ReactNode,
): ResolvedReplacement<PluginThreadListSlot> {
  return {
    kind: "plugin",
    registration: {
      pluginId: "demo",
      generation: 1,
      id: "list",
      title: "Demo list",
      component,
    },
  };
}

function renderList(replacement: ResolvedReplacement<PluginThreadListSlot>) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <PluginThreadList replacement={replacement} onNavigate={() => {}} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetPluginFrontendBootStateForTest();
  toast.error.mockClear();
});

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginThreadList", () => {
  it("shows the loading placeholder until plugin frontends have booted, then the missing state", () => {
    const { container } = renderList({ kind: "owner" });
    expect(
      container.querySelector('[data-thread-list-placeholder="loading"]'),
    ).not.toBeNull();

    act(() => markPluginFrontendsSettled());

    expect(
      container.querySelector('[data-thread-list-placeholder="missing"]'),
    ).not.toBeNull();
    expect(screen.getByText("No thread list plugin is enabled.")).toBeDefined();
  });

  it("renders the plugin list with the host props and no delegation component", () => {
    const seen: PluginThreadListProps[] = [];
    renderList(
      pluginReplacement((props) => {
        seen.push(props);
        return <div data-testid="plugin-list">plugin list</div>;
      }),
    );

    expect(screen.getByTestId("plugin-list")).toBeDefined();
    expect(seen[0]).toMatchObject({
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      searchQuery: "",
    });
    expect("Original" in (seen[0] ?? {})).toBe(false);
  });

  it("replaces a crashed list with the crashed placeholder and remounts on reload", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let shouldCrash = true;
    const { container } = renderList(
      pluginReplacement(() => {
        if (shouldCrash) throw new Error("boom");
        return <div data-testid="plugin-list">recovered</div>;
      }),
    );

    expect(
      container.querySelector('[data-thread-list-placeholder="crashed"]'),
    ).not.toBeNull();
    expect(screen.getByText("Demo list stopped working.")).toBeDefined();
    expect(toast.error).toHaveBeenCalledTimes(1);

    shouldCrash = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(screen.getByTestId("plugin-list").textContent).toBe("recovered");
    expect(
      container.querySelector("[data-thread-list-placeholder]"),
    ).toBeNull();
  });
});
