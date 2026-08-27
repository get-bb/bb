// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopApi,
  BbDesktopCliCommandApi,
  BbDesktopCliCommandInstallResult,
  BbDesktopCliCommandStatus,
  BbDesktopInfo,
} from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { CliCommandSettingsSection } from "./CliCommandSettingsSection";

const appToastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: appToastMock,
}));

const desktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const notInstalledStatus: BbDesktopCliCommandStatus = {
  binDir: "/home/user/.bb/bin",
  commandName: "bb",
  matches: [],
  onPath: false,
  ownEntryWins: false,
  wrapperInstalled: false,
};

function installedStatus(): BbDesktopCliCommandStatus {
  return {
    binDir: "/home/user/.bb/bin",
    commandName: "bb",
    matches: ["/home/user/.bb/bin/bb"],
    onPath: true,
    ownEntryWins: true,
    wrapperInstalled: true,
  };
}

function setDesktopApi(cliCommand: BbDesktopCliCommandApi | undefined): void {
  const api: BbDesktopApi = {
    ...createBbDesktopApi(desktopInfo),
    ...(cliCommand === undefined ? {} : { cliCommand }),
  };
  window.bbDesktop = api;
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  vi.clearAllMocks();
});

describe("CliCommandSettingsSection", () => {
  it("renders nothing when the desktop bridge has no cliCommand (dev build, web build, or old shell)", () => {
    setDesktopApi(undefined);

    const { container } = render(<CliCommandSettingsSection />);

    expect(container.innerHTML).toBe("");
  });

  it("shows a success toast on a genuine write", async () => {
    const result: BbDesktopCliCommandInstallResult = {
      detail: "/home/user/.bb/bin/bb",
      outcome: "written",
      status: installedStatus(),
    };
    setDesktopApi({
      async getStatus() {
        return notInstalledStatus;
      },
      async install() {
        return result;
      },
    });

    render(<CliCommandSettingsSection />);
    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    fireEvent.click(screen.getByRole("button", { name: /install/i }));

    await waitFor(() => {
      expect(appToastMock.success).toHaveBeenCalledWith(
        "Installed bb in /home/user/.bb/bin",
      );
    });
    expect(appToastMock.error).not.toHaveBeenCalled();
  });

  it("shows a distinct error naming the path for a foreign-file refusal, not a success toast", async () => {
    const result: BbDesktopCliCommandInstallResult = {
      detail: "/home/user/.bb/bin/bb",
      outcome: "foreign-file",
      status: notInstalledStatus,
    };
    setDesktopApi({
      async getStatus() {
        return notInstalledStatus;
      },
      async install() {
        return result;
      },
    });

    render(<CliCommandSettingsSection />);
    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    fireEvent.click(screen.getByRole("button", { name: /install/i }));

    await waitFor(() => {
      expect(appToastMock.error).toHaveBeenCalledWith(
        expect.stringContaining("/home/user/.bb/bin/bb"),
      );
    });
    expect(appToastMock.error).toHaveBeenCalledWith(
      expect.stringContaining("wasn't written by bb"),
    );
    expect(appToastMock.success).not.toHaveBeenCalled();
  });

  it("shows the failure, not a success toast, when the write fails", async () => {
    const result: BbDesktopCliCommandInstallResult = {
      detail: "EACCES: permission denied",
      outcome: "failed",
      status: notInstalledStatus,
    };
    setDesktopApi({
      async getStatus() {
        return notInstalledStatus;
      },
      async install() {
        return result;
      },
    });

    render(<CliCommandSettingsSection />);
    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    fireEvent.click(screen.getByRole("button", { name: /install/i }));

    await waitFor(() => {
      expect(appToastMock.error).toHaveBeenCalledWith(
        "EACCES: permission denied",
      );
    });
    expect(appToastMock.success).not.toHaveBeenCalled();
  });

  it("reports nothing-to-install rather than success when there is no target for this build", async () => {
    const result: BbDesktopCliCommandInstallResult = {
      outcome: "unsupported",
      status: notInstalledStatus,
    };
    setDesktopApi({
      async getStatus() {
        return notInstalledStatus;
      },
      async install() {
        return result;
      },
    });

    render(<CliCommandSettingsSection />);
    await waitFor(() => screen.getByRole("button", { name: /install/i }));
    fireEvent.click(screen.getByRole("button", { name: /install/i }));

    await waitFor(() => {
      expect(appToastMock.error).toHaveBeenCalledWith(
        "Nothing to install for this build.",
      );
    });
    expect(appToastMock.success).not.toHaveBeenCalled();
  });
});
