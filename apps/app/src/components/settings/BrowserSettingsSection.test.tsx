// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSettingsSectionContent } from "./BrowserSettingsSection";

const sources: DesktopBrowserImportSource[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    profiles: [
      { directory: "Default", name: "Person 1", cookieCount: 3 },
      { directory: "Profile 1", name: "Work", cookieCount: 1 },
    ],
  },
  { id: "brave", name: "Brave", profiles: [], unavailable: "browserRunning" },
  { id: "arc", name: "Arc", profiles: [], unavailable: "notInstalled" },
  {
    id: "safari",
    name: "Safari",
    profiles: [],
    unavailable: "unsupportedPlatform",
  },
];

function makeDesktopBrowser(
  overrides: Partial<BbDesktopBrowserApi> = {},
): BbDesktopBrowserApi {
  const noop = () => undefined;
  return {
    attach: noop,
    detach: noop,
    navigate: noop,
    goBack: noop,
    goForward: noop,
    reload: noop,
    stop: noop,
    setBounds: noop,
    setVisible: noop,
    onState: () => noop,
    onOpenTab: () => noop,
    listImportSources: vi.fn(async () => ({ sources })),
    importCookies: vi.fn(async () => ({
      ok: true as const,
      imported: 2,
      skipped: 1,
      skippedDomains: ["accounts.example.com"],
    })),
    ...overrides,
  };
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Import cookies…" }));
}

afterEach(() => {
  cleanup();
});

describe("BrowserSettingsSectionContent", () => {
  it("explains that import is desktop only outside the desktop app", () => {
    render(<BrowserSettingsSectionContent desktopBrowser={null} />);
    expect(
      screen.getByText("Only available in the BB desktop app."),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Import cookies…" }),
    ).toBeNull();
  });

  it("detects browsers when the import button is pressed and hides absent ones", async () => {
    const desktopBrowser = makeDesktopBrowser();
    render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
    expect(desktopBrowser.listImportSources).not.toHaveBeenCalled();
    openDialog();
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getByText("Quit first")).toBeDefined();
    expect(screen.queryByText("Arc")).toBeNull();
    expect(screen.queryByText("Safari")).toBeNull();
    expect(
      screen.getByText("2 profiles · Person 1 (3 cookies), Work (1 cookie)"),
    ).toBeDefined();
  });

  it("walks browser choice, profile choice, and import, then reports the outcome", async () => {
    const desktopBrowser = makeDesktopBrowser();
    render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
    openDialog();
    await waitFor(() =>
      expect(screen.getByTestId("browser-import-source-chrome")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("browser-import-source-chrome"));
    expect(screen.getByText("Import from Google Chrome")).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: /Work/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 cookie" }));
    await waitFor(() =>
      expect(screen.getByText("Imported 2 cookies")).toBeDefined(),
    );
    expect(desktopBrowser.importCookies).toHaveBeenCalledWith({
      sourceId: "chrome",
      sourceProfileDirectory: "Profile 1",
      profile: { kind: "personal" },
    });
    expect(screen.getByText("accounts.example.com")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.getByText(/Last import: Google Chrome/)).toBeDefined(),
    );
  });

  it("opens a running browser on the quit step, rechecks, and can go back", async () => {
    const listImportSources = vi
      .fn()
      .mockResolvedValueOnce({ sources })
      .mockResolvedValueOnce({
        sources: sources.map((source) =>
          source.id === "brave"
            ? {
                ...source,
                unavailable: undefined,
                profiles: [{ directory: "Default", name: "Default" }],
              }
            : source,
        ),
      })
      .mockResolvedValue({ sources });
    render(
      <BrowserSettingsSectionContent
        desktopBrowser={makeDesktopBrowser({ listImportSources })}
      />,
    );
    openDialog();
    await waitFor(() =>
      expect(screen.getByTestId("browser-import-source-brave")).toBeDefined(),
    );
    fireEvent.click(screen.getByTestId("browser-import-source-brave"));
    expect(screen.getByText("Quit Brave to import")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "I've quit it" }));
    await waitFor(() =>
      expect(screen.getByText("Import from Brave")).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(
        screen.getByText("Import cookies from another browser"),
      ).toBeDefined(),
    );
  });
});
