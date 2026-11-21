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
import type { ExclusiveResolution } from "@/lib/plugin-replacement-preference";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { PluginThreadList } from "./PluginThreadList";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/components/ui/app-toast", () => ({ appToast: toast }));

function pluginReplacement(
  component: (props: PluginThreadListProps) => React.ReactNode,
): ExclusiveResolution<PluginThreadListSlot> {
  return {
    kind: "plugin",
    registration: {
      pluginId: "demo",
      generation: 1,
      id: "list",
      title: "Demo list",
      component,
    },
    fallback: null,
  };
}

function renderList(replacement: ExclusiveResolution<PluginThreadListSlot>) {
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
    const { container } = renderList({ kind: "builtin" });
    expect(
      container.querySelector('[data-thread-list-placeholder="loading"]'),
    ).not.toBeNull();
    expect(screen.getByLabelText("Loading sidebar navigation")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();

    act(() => markPluginFrontendsSettled());

    expect(
      container.querySelector('[data-thread-list-placeholder="missing"]'),
    ).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "No thread list plugin is enabled.",
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
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
    expect(screen.getByRole("alert").textContent).toContain(
      "Demo list stopped working.",
    );
    expect(toast.error).toHaveBeenCalledTimes(1);

    shouldCrash = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(screen.getByTestId("plugin-list").textContent).toBe("recovered");
    expect(
      container.querySelector("[data-thread-list-placeholder]"),
    ).toBeNull();
  });

  it("shows the bundled list while an installed list is crashed, and the toast's Reload brings the installed one back", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let shouldCrash = true;
    const replacement = pluginReplacement(() => {
      if (shouldCrash) throw new Error("boom");
      return <div data-testid="plugin-list">recovered</div>;
    });
    if (replacement.kind !== "plugin") throw new Error("expected a plugin");
    const { container } = renderList({
      ...replacement,
      fallback: {
        pluginId: "thread-list",
        generation: 1,
        id: "thread-list",
        title: "Thread list",
        component: () => <div data-testid="bundled-list">bundled</div>,
      },
    });

    expect(screen.getByTestId("bundled-list")).toBeDefined();
    expect(
      container.querySelector("[data-thread-list-placeholder]"),
    ).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [, options] = toast.error.mock.calls[0] ?? [];
    expect(options.action.label).toBe("Reload");

    shouldCrash = false;
    act(() => {
      options.action.onClick();
    });

    expect(screen.getByTestId("plugin-list").textContent).toBe("recovered");
    expect(screen.queryByTestId("bundled-list")).toBeNull();
  });
});
