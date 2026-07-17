// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { appToast } from "@/components/ui/app-toast.js";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { sdk } from "@/lib/sdk";
import { UpdatesSettingsSection } from "./UpdatesSettingsSection";

vi.mock("@/components/ui/app-toast.js", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { version: vi.fn() } },
}));

const desktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.5",
};

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderUpdatesSettingsSection() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <UpdatesSettingsSection />
    </QueryClientProvider>,
  );
}

function clickCheckForUpdates(): void {
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  vi.clearAllMocks();
});

describe("UpdatesSettingsSection", () => {
  it("forces the web update check and reports an available update", async () => {
    vi.mocked(sdk.system.version).mockResolvedValue({
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm",
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    });

    renderUpdatesSettingsSection();
    clickCheckForUpdates();

    await waitFor(() => {
      expect(sdk.system.version).toHaveBeenCalledWith({ force: true });
    });
    expect(appToast.message).toHaveBeenCalledWith(
      "bb-app update available",
      expect.objectContaining({
        description: "0.0.6 is available. Run `npx bb-app@latest` to update.",
        duration: Infinity,
      }),
    );
  });

  it("checks for desktop updates through the desktop bridge", async () => {
    const checkForUpdates = vi.fn().mockResolvedValue({
      ...desktopInfo,
      latestVersion: "0.0.6",
      pendingVersion: "0.0.6",
      updateAvailable: true,
      updateDownloaded: true,
    });
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      checkForUpdates,
    };

    renderUpdatesSettingsSection();
    clickCheckForUpdates();

    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
    expect(sdk.system.version).not.toHaveBeenCalled();
    expect(appToast.message).toHaveBeenCalledWith(
      "Desktop update ready",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Relaunch" }),
        description: "bb desktop 0.0.6 is ready to install.",
        duration: Infinity,
      }),
    );
  });
});
