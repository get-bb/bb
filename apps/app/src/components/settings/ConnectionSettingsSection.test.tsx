// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopServerOption,
  BbDesktopServerTarget,
} from "@bb/desktop-contract";
import {
  ConnectionSettingsSection,
  MANAGE_FROM_THIS_MAC_TEXT,
} from "./ConnectionSettingsSection";

interface DesktopStub {
  addCustomServer: ReturnType<typeof vi.fn>;
  removeCustomServer: ReturnType<typeof vi.fn>;
  setServerTarget: ReturnType<typeof vi.fn>;
}

const BUILTIN: BbDesktopServerOption = {
  id: "builtin",
  kind: "builtin",
  name: "This Mac",
  selected: true,
  url: null,
};

const CUSTOM: BbDesktopServerOption = {
  id: "id-1",
  kind: "custom",
  name: "Office",
  selected: false,
  url: "https://office.example.com",
};

function installDesktopApi(
  target: Pick<BbDesktopServerTarget, "canManageServers">,
): DesktopStub {
  const stub: DesktopStub = {
    addCustomServer: vi.fn(() => Promise.resolve(true)),
    removeCustomServer: vi.fn(() => Promise.resolve(true)),
    setServerTarget: vi.fn(() => Promise.resolve(true)),
  };
  Object.defineProperty(window, "bbDesktop", {
    configurable: true,
    value: {
      experimental_getServerTarget: () =>
        Promise.resolve({
          canManageServers: target.canManageServers,
          connectServersSkipReason: null,
          connectTrusted: true,
          servers: [BUILTIN, CUSTOM],
        } satisfies BbDesktopServerTarget),
      experimental_onServerTargetChange: () => () => {},
      experimental_setServerTarget: stub.setServerTarget,
      experimental_addCustomServer: stub.addCustomServer,
      experimental_removeCustomServer: stub.removeCustomServer,
      experimental_setConnectTrusted: vi.fn(() => Promise.resolve(true)),
    },
  });
  return stub;
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement | HTMLInputElement).disabled;
}

function renderSection(remoteAccessPluginId: string | null = "connect"): void {
  render(
    <MemoryRouter>
      <ConnectionSettingsSection remoteAccessPluginId={remoteAccessPluginId} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("ConnectionSettingsSection", () => {
  it("adds a server by URL and removes an existing one", async () => {
    const stub = installDesktopApi({ canManageServers: true });
    renderSection();

    const address = await screen.findByLabelText("Server address");
    expect(screen.queryByText(MANAGE_FROM_THIS_MAC_TEXT)).toBeNull();

    fireEvent.change(address, {
      target: { value: "https://studio.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(stub.addCustomServer).toHaveBeenCalledWith(
      "",
      "https://studio.example.com",
    );

    const remove = screen.getByRole("button", { name: "Remove Office" });
    await waitFor(() => {
      expect(isDisabled(remove)).toBe(false);
    });
    fireEvent.click(remove);
    expect(stub.removeCustomServer).toHaveBeenCalledWith("id-1");
  });

  it("links to remote access when the plugin is available", async () => {
    installDesktopApi({ canManageServers: true });
    renderSection("connect");

    const link = await screen.findByRole("link", {
      name: /set up remote access/iu,
    });
    expect(link.getAttribute("href")).toBe("/settings/plugins/connect");
  });

  it("omits the remote access link when the plugin is missing", async () => {
    installDesktopApi({ canManageServers: true });
    renderSection(null);

    await screen.findByLabelText("Server address");
    expect(screen.queryByRole("link", { name: /set up remote access/iu })).toBe(
      null,
    );
  });

  it("disables management but not switching while viewing a remote server", async () => {
    const stub = installDesktopApi({ canManageServers: false });
    renderSection();

    expect(await screen.findByText(MANAGE_FROM_THIS_MAC_TEXT)).not.toBeNull();
    expect(isDisabled(screen.getByLabelText("Server address"))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Add" }))).toBe(true);

    const removeCustom = screen.getByRole("button", { name: "Remove Office" });
    expect(isDisabled(removeCustom)).toBe(true);
    fireEvent.click(removeCustom);
    expect(stub.removeCustomServer).not.toHaveBeenCalled();

    const use = screen.getByRole("button", { name: "Use Office" });
    expect(isDisabled(use)).toBe(false);
    fireEvent.click(use);
    expect(stub.setServerTarget).toHaveBeenCalledWith("id-1");
  });
});
