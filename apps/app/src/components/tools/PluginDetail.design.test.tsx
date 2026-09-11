// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePluginListItem } from "@/test/fixtures/plugins";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { pluginSourceQueryKey } from "@/hooks/queries/query-keys";
import { PluginDetail, PluginDetailBanners } from "./PluginDetail";

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

function ComposeProbe() {
  const location = useLocation();
  return (
    <output data-testid="compose-state">
      {JSON.stringify(location.state)}
    </output>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard === undefined)
    Reflect.deleteProperty(navigator, "clipboard");
  else Object.defineProperty(navigator, "clipboard", originalClipboard);
});

describe("plugin detail design behavior", () => {
  it("keeps the actual cause and paired recovery actions in one banner and prepares a report without reloading", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins/traces"]}>
        <PluginDetailBanners
          plugin={makePluginListItem({
            id: "traces",
            name: "Traces",
            source: "git:https://github.com/patleeman/bb-plugins.git@main",
            status: "error",
            statusDetail:
              "Startup failed: the configured session directory does not exist.",
          })}
        />
        <ComposeProbe />
      </MemoryRouter>,
      { wrapper },
    );
    const banner = screen.getByRole("alert");
    expect(screen.getAllByText(/Startup failed:/u)).toHaveLength(1);
    expect(
      within(banner)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Reload", "Report to author"]);
    expect(screen.queryByText("Recent errors")).toBeNull();
    fireEvent.click(
      within(banner).getByRole("button", { name: "Report to author" }),
    );
    expect(screen.getByTestId("compose-state").textContent).toContain(
      "report-plugin-issue",
    );
    expect(screen.getByTestId("compose-state").textContent).toContain(
      "https://github.com/patleeman/bb-plugins",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provides the full local source through one Open/Copy row without an update action", async () => {
    const path =
      "/home/reviewer/very-long-local-workspace/plugins/review-notes";
    const plugin = makePluginListItem({
      rootDir: path,
      source: `path:${path}`,
    });
    const onOpenSource = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(pluginSourceQueryKey(plugin.id), null);
    render(
      <MemoryRouter>
        <PluginDetail
          isLoading={false}
          plugin={plugin}
          pending={false}
          openSourceDisabled={false}
          onToggle={() => undefined}
          onEdit={() => undefined}
          onOpenSource={onOpenSource}
          onDelete={() => undefined}
          catalogEntries={[]}
          onOpenPlugin={() => undefined}
        />
      </MemoryRouter>,
      { wrapper },
    );
    const source = screen
      .getByRole("heading", { name: "Source" })
      .closest("section");
    expect(source).not.toBeNull();
    if (source === null) return;
    expect(
      within(source).getByText(
        "~/very-long-local-workspace/plugins/review-notes",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(source).getByRole("button", { name: "Open source" }),
    );
    expect(onOpenSource).toHaveBeenCalledWith(plugin);
    fireEvent.click(
      within(source).getByRole("button", { name: `Copy plugin path: ${path}` }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(path));
    expect(screen.queryByRole("button", { name: /Check/u })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
    expect(screen.getByRole("heading", { name: "About" })).toBeTruthy();
    expect(screen.getByText("Install date unavailable")).toBeTruthy();
  });

  it("opens available configuration for a path failure and keeps local reporting honestly unavailable", () => {
    const onConfigure = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginDetailBanners
          plugin={makePluginListItem({
            status: "error",
            hasSettings: true,
            statusDetail: "The configured directory does not exist.",
          })}
          onConfigure={onConfigure}
        />
        <ComposeProbe />
      </MemoryRouter>,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onConfigure).toHaveBeenCalledOnce();
    const report = screen.getByRole("button", { name: "Report to author" });
    expect(report.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(report);
    expect(screen.getByTestId("compose-state").textContent).toBe("null");
  });

  it("retains a failed reload cause in the banner and report draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Host offline")),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginDetailBanners
          plugin={makePluginListItem({
            source: "git:https://github.com/patleeman/bb-plugins.git@main",
            status: "error",
            statusDetail: "Startup failed",
          })}
        />
        <ComposeProbe />
      </MemoryRouter>,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Host offline");
    });
    fireEvent.click(screen.getByRole("button", { name: "Report to author" }));
    expect(screen.getByTestId("compose-state").textContent).toContain(
      "Host offline",
    );
  });
});
