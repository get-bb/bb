// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host } from "@bb/domain";
import type { HostPlatform } from "@bb/host-daemon-contract";
import type { HostResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPathDialog } from "./ProjectPathDialog";

vi.mock("@/components/dialogs/RemotePathBrowser", () => ({
  RemotePathBrowser: ({
    hostId,
    allowCreateFolder,
    pathPlaceholder,
    onDirectoryChange,
  }: {
    hostId: string;
    allowCreateFolder: boolean;
    pathPlaceholder: string;
    onDirectoryChange: (directory: string) => void;
  }) => (
    <button
      type="button"
      data-allow-create-folder={String(allowCreateFolder)}
      data-path-placeholder={pathPlaceholder}
      onClick={() =>
        onDirectoryChange(
          hostId === "host_kunst"
            ? "/Users/amadad/projects/reachy_mini"
            : hostId === "host_wsl"
              ? "/mnt/c/Users/amadad/projects/reachy_mini"
              : hostId === "host_long"
                ? `/home/deploy/repos/${"long-project-name-".repeat(20)}`
                : "/home/deploy/repos/givecare",
        )
      }
    >
      Choose folder on {hostId}
    </button>
  ),
}));

function host(
  overrides: Partial<Host> &
    Pick<Host, "id" | "name"> & { platform?: HostPlatform },
): HostResponse {
  const status = overrides.status ?? "connected";
  const fields = {
    type: "persistent" as const,
    lastSeenAt: null,
    maxPermissionMode: "full" as const,
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
  return status === "connected"
    ? {
        ...fields,
        status,
        connectedRuntime: { platform: overrides.platform ?? "linux" },
      }
    : { ...fields, status, connectedRuntime: null };
}

const atum = host({ id: "host_atum", name: "atum" });
const kunst = host({
  id: "host_kunst",
  name: "Kunst",
  platform: "darwin",
});
const wsl = host({
  id: "host_wsl",
  name: "WSL dev",
  platform: "wsl",
});
const offline = host({
  id: "host_offline",
  name: "Offline Mac",
  status: "disconnected",
});
const offlineKunst = host({
  id: kunst.id,
  name: kunst.name,
  status: "disconnected",
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectPathDialog machine selection", () => {
  it("creates a project from a folder on the selected connected machine", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum, kunst, offline]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(trigger.textContent).toContain("atum");
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_atum" })
        .getAttribute("data-allow-create-folder"),
    ).toBe("true");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      screen
        .getByRole("menuitem", { name: /Offline Mac/u })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: /Kunst/u }));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_kunst" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/Users/amadad/projects/reachy_mini",
      "host_kunst",
    );
  });

  it("uses the selected host's path syntax and restores the local Mac picker", () => {
    const onPickNativeFolder = vi.fn();
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="darwin"
        hostId={kunst.id}
        hostName={kunst.name}
        hosts={[kunst, atum, wsl]}
        nativeFolderPicker={{
          hostId: kunst.id,
          onPick: onPickNativeFolder,
        }}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(screen.getByText(/edit the macOS path directly/u)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_kunst" })
        .getAttribute("data-path-placeholder"),
    ).toBe("/Users/me/project");
    expect(
      screen.getByRole("button", { name: "Choose folder with Finder" }),
    ).toBeTruthy();

    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: /atum/u }));
    expect(screen.getByText(/edit the Linux path directly/u)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_atum" })
        .getAttribute("data-path-placeholder"),
    ).toBe("/home/me/project");
    expect(
      screen.queryByRole("button", { name: "Choose folder with Finder" }),
    ).toBeNull();

    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: /WSL dev/u }));
    expect(screen.getByText(/edit the WSL path directly/u)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_wsl" })
        .getAttribute("data-path-placeholder"),
    ).toBe("/mnt/c/Users/me/project");
    expect(
      screen.queryByRole("button", { name: "Choose folder with Finder" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_wsl" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      { kind: "create" },
      "/mnt/c/Users/amadad/projects/reachy_mini",
      "host_wsl",
    );

    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Kunst/u }));
    expect(screen.getByText(/edit the macOS path directly/u)).toBeTruthy();
    const nativePicker = screen.getByRole("button", {
      name: "Choose folder with Finder",
    });
    fireEvent.click(nativePicker);
    expect(onPickNativeFolder).toHaveBeenCalledWith({ kind: "create" });
  });

  it("preserves the direct single-machine folder flow", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(onSubmit).toHaveBeenCalledWith(
      { kind: "create" },
      "/home/deploy/repos/givecare",
      "host_atum",
    );
  });

  // With machines listed but none selectable there is no host to resolve a
  // path against, so the manual-path fallback must not invite a submit that
  // the picker hook would drop without feedback.
  it("blocks submission when every listed machine is offline", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={null}
        hostName={null}
        hosts={[offline, offlineKunst]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText("Project path")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Add project" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
