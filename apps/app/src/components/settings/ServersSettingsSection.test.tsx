// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopServerListEntry,
  BbDesktopServersApi,
} from "@bb/desktop-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  ADD_FAILURE_MESSAGES,
  ServersSettingsSection,
  ServersSettingsSectionContent,
} from "./ServersSettingsSection";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.5",
};

function serverEntry(
  overrides: Partial<BbDesktopServerListEntry> &
    Pick<BbDesktopServerListEntry, "id" | "name" | "source" | "url">,
): BbDesktopServerListEntry {
  return {
    active: false,
    color: null,
    icon: null,
    status: "offline",
    ...overrides,
  };
}

function createServersApi(
  overrides: Partial<BbDesktopServersApi> = {},
): BbDesktopServersApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue({
      ok: true,
      server: serverEntry({
        id: "manual_1",
        name: "Manual",
        source: "manual",
        url: "https://example.com",
      }),
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    setTileStyle: vi.fn().mockResolvedValue(undefined),
    getAutoConnect: vi.fn().mockResolvedValue(true),
    setAutoConnect: vi.fn().mockResolvedValue(undefined),
    getShowConnectServers: vi.fn().mockResolvedValue(true),
    setShowConnectServers: vi.fn().mockResolvedValue(undefined),
    onChange: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ServersSettingsSection", () => {
  it("renders nothing when the desktop servers bridge is absent", () => {
    const { container } = render(<ServersSettingsSection />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Servers")).toBeNull();
  });

  it("loads list and auto-connect from the bridge and unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    const servers = createServersApi({
      list: vi.fn().mockResolvedValue([
        serverEntry({
          id: "builtin",
          name: "Local",
          source: "builtin",
          url: "http://127.0.0.1:3000",
          active: true,
          status: "connected",
        }),
      ]),
      getAutoConnect: vi.fn().mockResolvedValue(false),
      onChange: vi.fn().mockReturnValue(unsubscribe),
    });
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      servers,
    };

    const { unmount } = render(<ServersSettingsSection />);

    await waitFor(() => {
      expect(screen.getByText("Local")).toBeDefined();
    });
    expect(screen.getByText("Built-in")).toBeDefined();
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByLabelText("Auto-connect to local servers")).toHaveProperty(
      "ariaChecked",
      "false",
    );
    expect(servers.onChange).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("ServersSettingsSectionContent", () => {
  it("maps add() failure reasons to user-facing errors and clears on success", async () => {
    const onAdd = vi
      .fn()
      .mockResolvedValueOnce(ADD_FAILURE_MESSAGES.duplicate)
      .mockResolvedValueOnce(ADD_FAILURE_MESSAGES.incompatible)
      .mockResolvedValueOnce(ADD_FAILURE_MESSAGES.unreachable)
      .mockResolvedValueOnce(null);

    render(
      <ServersSettingsSectionContent
        autoConnect={true}
        onAdd={onAdd}
        onAutoConnectChange={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onSetActive={vi.fn()}
        onSetTileStyle={vi.fn()}
        onShowConnectServersChange={vi.fn()}
        servers={[]}
        showConnectServers={true}
      />,
    );

    const urlInput = screen.getByLabelText("Server URL");
    const submit = screen.getByRole("button", { name: "Add" });

    fireEvent.change(urlInput, {
      target: { value: "https://dup.example.com" },
    });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        ADD_FAILURE_MESSAGES.duplicate,
      );
    });

    fireEvent.change(urlInput, {
      target: { value: "https://bad.example.com" },
    });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        ADD_FAILURE_MESSAGES.incompatible,
      );
    });

    fireEvent.change(urlInput, {
      target: { value: "https://down.example.com" },
    });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        ADD_FAILURE_MESSAGES.unreachable,
      );
    });

    fireEvent.change(urlInput, {
      target: { value: "https://ok.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Server name (optional)"), {
      target: { value: "Staging" },
    });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(onAdd).toHaveBeenLastCalledWith({
        name: "Staging",
        url: "https://ok.example.com",
      });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((urlInput as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByLabelText("Server name (optional)") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("groups rows by source and shows Built-in / Active badges", () => {
    render(
      <ServersSettingsSectionContent
        autoConnect={false}
        onAdd={vi.fn()}
        onAutoConnectChange={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onSetActive={vi.fn()}
        onSetTileStyle={vi.fn()}
        onShowConnectServersChange={vi.fn()}
        showConnectServers={true}
        servers={[
          serverEntry({
            id: "builtin",
            name: "Built-in server",
            source: "builtin",
            url: "http://127.0.0.1:3000",
            active: true,
            status: "connected",
          }),
          serverEntry({
            id: "connect_1",
            name: "Office",
            source: "connect",
            url: "https://office.getbb.app",
            status: "offline",
          }),
          serverEntry({
            id: "manual_1",
            name: "Lab",
            source: "manual",
            url: "https://lab.example.com",
            status: "incompatible",
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("BB Connect — synced from your account"),
    ).toBeDefined();
    expect(screen.getByText("Added manually")).toBeDefined();

    const builtinRow = screen.getByTestId("server-row-builtin");
    expect(within(builtinRow).getByText("Built-in")).toBeDefined();
    expect(within(builtinRow).getByText("Active")).toBeDefined();
    expect(within(builtinRow).getByText("Connected")).toBeDefined();
    expect(
      within(builtinRow).queryByRole("button", { name: "Remove Built-in server" }),
    ).toBeNull();

    const connectRow = screen.getByTestId("server-row-connect_1");
    expect(within(connectRow).getByText("Offline")).toBeDefined();
    expect(
      within(connectRow).queryByRole("button", { name: "Remove Office" }),
    ).toBeNull();

    const manualRow = screen.getByTestId("server-row-manual_1");
    expect(within(manualRow).getByText("Incompatible")).toBeDefined();
    expect(
      within(manualRow).getByRole("button", { name: "Remove Lab" }),
    ).toBeDefined();
  });

  it("removes on click without a blocking confirm", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const servers = createServersApi({
      list: vi.fn().mockResolvedValue([
        serverEntry({
          id: "manual_1",
          name: "Lab",
          source: "manual",
          url: "https://lab.example.com",
        }),
      ]),
      remove,
    });
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      servers,
    };

    render(<ServersSettingsSection />);
    const removeButton = await screen.findByRole("button", {
      name: "Remove Lab",
    });

    fireEvent.click(removeButton);
    expect(remove).toHaveBeenCalledWith("manual_1");
  });

  it("applies setTileStyle from the logo picker on all row sources", async () => {
    const onSetTileStyle = vi.fn();
    render(
      <ServersSettingsSectionContent
        autoConnect={true}
        onAdd={vi.fn()}
        onAutoConnectChange={vi.fn()}
        onRemove={vi.fn()}
        onRename={vi.fn()}
        onSetActive={vi.fn()}
        onSetTileStyle={onSetTileStyle}
        onShowConnectServersChange={vi.fn()}
        showConnectServers={true}
        servers={[
          serverEntry({
            id: "builtin",
            name: "This Mac",
            source: "builtin",
            url: "http://127.0.0.1:3000",
            active: true,
            status: "connected",
          }),
          serverEntry({
            id: "connect_1",
            name: "Office",
            source: "connect",
            url: "https://office.getbb.app",
          }),
        ]}
      />,
    );

    // Available on builtin (style is a local overlay, unlike rename).
    fireEvent.click(
      screen.getByRole("button", { name: "Customize This Mac icon" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Zap" }));
    expect(onSetTileStyle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "builtin" }),
      { icon: "Zap", color: null },
    );

    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(onSetTileStyle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "builtin" }),
      { icon: "Zap", color: "blue" },
    );

    // Connect rows get the same picker.
    fireEvent.click(
      screen.getByRole("button", { name: "Customize Office icon" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Terminal" }));
    expect(onSetTileStyle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "connect_1" }),
      { icon: "Terminal", color: null },
    );
  });

  it("wires the bridge setTileStyle method", async () => {
    const setTileStyle = vi.fn().mockResolvedValue(undefined);
    const servers = createServersApi({
      list: vi.fn().mockResolvedValue([
        serverEntry({
          id: "manual_1",
          name: "Lab",
          source: "manual",
          url: "https://lab.example.com",
        }),
      ]),
      setTileStyle,
    });
    window.bbDesktop = {
      ...createBbDesktopApi(desktopInfo),
      servers,
    };

    render(<ServersSettingsSection />);
    const customize = await screen.findByRole("button", {
      name: "Customize Lab icon",
    });
    fireEvent.click(customize);
    fireEvent.click(await screen.findByRole("button", { name: "Zap" }));
    expect(setTileStyle).toHaveBeenCalledWith({
      id: "manual_1",
      icon: "Zap",
      color: null,
    });
  });
});
