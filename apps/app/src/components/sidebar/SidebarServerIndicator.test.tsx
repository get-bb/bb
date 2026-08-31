// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopServerTarget,
  BbDesktopServerOption,
} from "@bb/desktop-contract";
import { SidebarServerIndicator } from "./SidebarServerIndicator";

function renderIndicator() {
  return render(
    <MemoryRouter>
      <ul>
        <SidebarServerIndicator />
      </ul>
    </MemoryRouter>,
  );
}

const testState = vi.hoisted(() => ({
  remoteUi: true,
  connectionState: "connected" as "connected" | "connecting" | "reconnecting",
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { experiments: { remoteUi: testState.remoteUi } },
  }),
}));

vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => testState.connectionState,
}));

function builtin(selected: boolean): BbDesktopServerOption {
  return {
    id: "builtin",
    kind: "builtin",
    name: "This Mac",
    selected,
    url: null,
  };
}

function connectServer(selected: boolean): BbDesktopServerOption {
  return {
    id: "connect:studio",
    kind: "connect",
    name: "studio",
    selected,
    url: "https://studio.getbb.app",
  };
}

function installDesktopApi(target: BbDesktopServerTarget): void {
  Object.defineProperty(window, "bbDesktop", {
    configurable: true,
    value: {
      experimental_getServerTarget: () => Promise.resolve(target),
      experimental_onServerTargetChange: () => () => {},
      experimental_setServerTarget: () => Promise.resolve(true),
      experimental_addCustomServer: () => Promise.resolve(true),
      experimental_removeCustomServer: () => Promise.resolve(true),
      experimental_setConnectTrusted: () => Promise.resolve(true),
    },
  });
}

beforeEach(() => {
  testState.remoteUi = true;
  testState.connectionState = "connected";
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("SidebarServerIndicator", () => {
  it("shows This Mac when the builtin server is selected", async () => {
    installDesktopApi({
      canManageServers: true,
      connectServersSkipReason: null,
      connectTrusted: true,
      servers: [builtin(true), connectServer(false)],
    });

    renderIndicator();

    const pill = await screen.findByTestId("sidebar-server-indicator");
    expect(pill.textContent).toContain("This Mac");
    expect(pill.getAttribute("aria-label")).toBe(
      "Server: This Mac (Connected)",
    );
  });

  it("shows the remote server name when a connect server is selected", async () => {
    installDesktopApi({
      canManageServers: true,
      connectServersSkipReason: null,
      connectTrusted: true,
      servers: [builtin(false), connectServer(true)],
    });

    renderIndicator();

    const pill = await screen.findByTestId("sidebar-server-indicator");
    expect(pill.textContent).toContain("studio");
    expect(pill.textContent).not.toContain("This Mac");
  });

  it("reports an unreachable server while the socket is reconnecting", async () => {
    testState.connectionState = "reconnecting";
    installDesktopApi({
      canManageServers: true,
      connectServersSkipReason: null,
      connectTrusted: true,
      servers: [builtin(true)],
    });

    renderIndicator();

    const pill = await screen.findByTestId("sidebar-server-indicator");
    expect(pill.getAttribute("aria-label")).toBe(
      "Server: This Mac (Unreachable)",
    );
  });

  it("links to the connection settings from the popover", async () => {
    installDesktopApi({
      canManageServers: true,
      connectServersSkipReason: null,
      connectTrusted: true,
      servers: [builtin(true), connectServer(false)],
    });

    renderIndicator();

    fireEvent.click(await screen.findByTestId("sidebar-server-indicator"));

    const manage = await screen.findByRole("link", { name: "Manage servers…" });
    expect(manage.getAttribute("href")).toBe("/settings/connection");
  });

  it("renders nothing in a window viewing a remote server", async () => {
    installDesktopApi({
      canManageServers: false,
      connectServersSkipReason: null,
      connectTrusted: true,
      servers: [builtin(false), connectServer(true)],
    });

    renderIndicator();

    await act(async () => {});
    await act(async () => {});
    expect(screen.queryByTestId("sidebar-server-indicator")).toBeNull();
  });

  it("renders nothing when the remoteUi experiment is off", async () => {
    testState.remoteUi = false;
    installDesktopApi({
      canManageServers: true,
      connectServersSkipReason: null,
      connectTrusted: true,
      servers: [builtin(true)],
    });

    renderIndicator();

    await waitFor(() => {
      expect(screen.queryByTestId("sidebar-server-indicator")).toBeNull();
    });
  });

  it("renders nothing outside the desktop app", async () => {
    renderIndicator();

    await waitFor(() => {
      expect(screen.queryByTestId("sidebar-server-indicator")).toBeNull();
    });
  });
});
