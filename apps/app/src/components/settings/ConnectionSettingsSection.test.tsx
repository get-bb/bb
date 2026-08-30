// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  setConnectTrusted: ReturnType<typeof vi.fn>;
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
  target: Pick<BbDesktopServerTarget, "canManageServers" | "connectTrusted">,
): DesktopStub {
  const stub: DesktopStub = {
    addCustomServer: vi.fn(() => Promise.resolve(true)),
    removeCustomServer: vi.fn(() => Promise.resolve(true)),
    setConnectTrusted: vi.fn(() => Promise.resolve(true)),
    setServerTarget: vi.fn(() => Promise.resolve(true)),
  };
  Object.defineProperty(window, "bbDesktop", {
    configurable: true,
    value: {
      experimental_getServerTarget: () =>
        Promise.resolve({
          canManageServers: target.canManageServers,
          connectServersSkipReason: null,
          connectTrusted: target.connectTrusted,
          servers: [BUILTIN, CUSTOM],
        } satisfies BbDesktopServerTarget),
      experimental_onServerTargetChange: () => () => {},
      experimental_setServerTarget: stub.setServerTarget,
      experimental_addCustomServer: stub.addCustomServer,
      experimental_removeCustomServer: stub.removeCustomServer,
      experimental_setConnectTrusted: stub.setConnectTrusted,
    },
  });
  return stub;
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement | HTMLInputElement).disabled;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("ConnectionSettingsSection", () => {
  it("adds a custom server and removes an existing one", async () => {
    const stub = installDesktopApi({
      canManageServers: true,
      connectTrusted: true,
    });
    render(<ConnectionSettingsSection />);

    const address = await screen.findByLabelText("Server address");
    expect(screen.queryByText(MANAGE_FROM_THIS_MAC_TEXT)).toBeNull();

    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "Studio" },
    });
    fireEvent.change(address, {
      target: { value: "https://studio.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(stub.addCustomServer).toHaveBeenCalledWith(
      "Studio",
      "https://studio.example.com",
    );

    const remove = screen.getByRole("button", { name: "Remove Office" });
    await waitFor(() => {
      expect(isDisabled(remove)).toBe(false);
    });
    fireEvent.click(remove);
    expect(stub.removeCustomServer).toHaveBeenCalledWith("id-1");
  });

  it("shows bb Connect as a removable default entry", async () => {
    const stub = installDesktopApi({
      canManageServers: true,
      connectTrusted: true,
    });
    render(<ConnectionSettingsSection />);

    expect(await screen.findByText("bb Connect")).not.toBeNull();
    expect(screen.getByText("Default")).not.toBeNull();

    const remove = screen.getByRole("button", { name: "Remove bb Connect" });
    await waitFor(() => {
      expect(isDisabled(remove)).toBe(false);
    });
    fireEvent.click(remove);
    expect(stub.setConnectTrusted).toHaveBeenCalledWith(false);
  });

  it("offers to add bb Connect back when it is not trusted", async () => {
    const stub = installDesktopApi({
      canManageServers: true,
      connectTrusted: false,
    });
    render(<ConnectionSettingsSection />);

    const add = await screen.findByRole("button", { name: "Add bb Connect" });
    expect(screen.queryByText("Default")).toBeNull();

    await waitFor(() => {
      expect(isDisabled(add)).toBe(false);
    });
    fireEvent.click(add);
    expect(stub.setConnectTrusted).toHaveBeenCalledWith(true);
  });

  it("disables management but not switching while viewing a remote server", async () => {
    const stub = installDesktopApi({
      canManageServers: false,
      connectTrusted: true,
    });
    render(<ConnectionSettingsSection />);

    expect(await screen.findByText(MANAGE_FROM_THIS_MAC_TEXT)).not.toBeNull();
    expect(isDisabled(screen.getByLabelText("Server address"))).toBe(true);
    expect(isDisabled(screen.getByLabelText("Server name"))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "Add" }))).toBe(true);

    const removeCustom = screen.getByRole("button", { name: "Remove Office" });
    const removeConnect = screen.getByRole("button", {
      name: "Remove bb Connect",
    });
    expect(isDisabled(removeCustom)).toBe(true);
    expect(isDisabled(removeConnect)).toBe(true);

    fireEvent.click(removeCustom);
    fireEvent.click(removeConnect);
    expect(stub.removeCustomServer).not.toHaveBeenCalled();
    expect(stub.setConnectTrusted).not.toHaveBeenCalled();

    const use = screen.getByRole("button", { name: "Use Office" });
    expect(isDisabled(use)).toBe(false);
    fireEvent.click(use);
    expect(stub.setServerTarget).toHaveBeenCalledWith("id-1");
  });
});
