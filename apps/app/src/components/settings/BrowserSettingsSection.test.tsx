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
import { BROWSER_IMPORT_RECORDS_STORAGE_KEY } from "./browser-import-wizard";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { success: vi.fn(), error: vi.fn() },
}));

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const sources: DesktopBrowserImportSource[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    icon: PNG,
    profiles: [
      { directory: "Default", name: "Person 1", cookieCount: 3 },
      { directory: "Profile 1", name: "Work", cookieCount: 1 },
    ],
  },
  {
    id: "firefox",
    name: "Firefox",
    profiles: [{ directory: "Profiles/p1", name: "default", cookieCount: 9 }],
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

function rowButton(id: string): HTMLButtonElement {
  const button = screen
    .getByTestId(`browser-import-${id}`)
    .querySelector("button");
  if (!button) throw new Error(`no button in row ${id}`);
  return button;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("BrowserSettingsSectionContent", () => {
  it("explains that import is desktop only outside the desktop app", () => {
    render(<BrowserSettingsSectionContent desktopBrowser={null} />);
    expect(
      screen.getByText("Only available in the BB desktop app."),
    ).toBeDefined();
  });

  it("lists installed browsers with icons and status, hiding absent ones", async () => {
    render(
      <BrowserSettingsSectionContent desktopBrowser={makeDesktopBrowser()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    expect(screen.queryByText("Arc")).toBeNull();
    expect(screen.queryByText("Safari")).toBeNull();
    expect(
      screen
        .getByTestId("browser-import-chrome")
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe(PNG);
    expect(screen.getByText("2 profiles")).toBeDefined();
    expect(screen.getByText("4 cookies")).toBeDefined();
    expect(screen.getByText("Running · quit Brave to import")).toBeDefined();
    expect(rowButton("brave").textContent).toBe("Recheck");
  });

  it("imports a single-profile browser directly and records it in the row", async () => {
    const desktopBrowser = makeDesktopBrowser();
    render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
    await waitFor(() => expect(screen.getByText("Firefox")).toBeDefined());
    fireEvent.click(rowButton("firefox"));
    await waitFor(() =>
      expect(screen.getByText("default · 2 cookies imported")).toBeDefined(),
    );
    expect(desktopBrowser.importCookies).toHaveBeenCalledWith({
      sourceId: "firefox",
      sourceProfileDirectory: "Profiles/p1",
      profile: { kind: "personal" },
    });
    expect(screen.getByText("1 skipped (accounts.example.com)")).toBeDefined();
    expect(screen.getByText("imported just now")).toBeDefined();
    expect(
      JSON.parse(
        window.localStorage.getItem(BROWSER_IMPORT_RECORDS_STORAGE_KEY) ?? "{}",
      ).firefox.imported,
    ).toBe(2);
  });

  it("asks for a profile when a browser has several, then imports it", async () => {
    const desktopBrowser = makeDesktopBrowser();
    render(<BrowserSettingsSectionContent desktopBrowser={desktopBrowser} />);
    await waitFor(() =>
      expect(screen.getByText("Google Chrome")).toBeDefined(),
    );
    fireEvent.click(rowButton("chrome"));
    expect(screen.getByText("Import from Google Chrome")).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: /Work/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 cookie" }));
    await waitFor(() =>
      expect(screen.getByText("Work · 2 cookies imported")).toBeDefined(),
    );
    expect(screen.queryByText("Import from Google Chrome")).toBeNull();
  });

  it("rechecks a running browser from its row", async () => {
    const listImportSources = vi
      .fn()
      .mockResolvedValueOnce({ sources })
      .mockResolvedValue({
        sources: sources.map((source) =>
          source.id === "brave"
            ? {
                ...source,
                unavailable: undefined,
                profiles: [
                  { directory: "Default", name: "Default", cookieCount: 5 },
                ],
              }
            : source,
        ),
      });
    render(
      <BrowserSettingsSectionContent
        desktopBrowser={makeDesktopBrowser({ listImportSources })}
      />,
    );
    await waitFor(() => expect(screen.getByText("Brave")).toBeDefined());
    fireEvent.click(rowButton("brave"));
    await waitFor(() => expect(rowButton("brave").textContent).toBe("Import…"));
    expect(screen.getByText("5 cookies")).toBeDefined();
  });
});
