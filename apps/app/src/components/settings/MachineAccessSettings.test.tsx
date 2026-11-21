// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

type SystemConfig = ReturnType<typeof makeSystemConfig>;
type ServerAccessProvider = SystemConfig["serverAccess"]["providers"][number];

const state = vi.hoisted(() => ({
  config: undefined as ReturnType<typeof makeSystemConfig> | undefined,
  listeners: new Set<() => void>(),
  mutate: vi.fn(),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
      },
      () => state.config,
    ),
  }),
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false, mutate: state.mutate }),
}));

function publish(next: (config: SystemConfig) => SystemConfig) {
  act(() => {
    state.config = next(state.config!);
    for (const listener of state.listeners) listener();
  });
}

function setProviders(providers: ServerAccessProvider[]) {
  publish((config) => ({
    ...config,
    serverAccess: { ...config.serverAccess, providers },
  }));
}

function setSettings(patch: Partial<SystemConfig["generalSettings"]>) {
  publish((config) => ({
    ...config,
    generalSettings: { ...config.generalSettings, ...patch },
  }));
}

const LAN: ServerAccessProvider = {
  id: "local-network",
  displayName: "Local network",
  description: "Devices on this network reach bb directly.",
  pluginId: null,
  routeKind: "local-network",
  enabled: false,
  availability: {
    status: "setup-required",
    message: "Turn on to let devices on this network reach bb",
  },
  urls: [],
};
const RELAY: ServerAccessProvider = {
  id: "relay",
  displayName: "Relay",
  description: "A relay",
  pluginId: "relay-plugin",
  routeKind: "relay",
  enabled: true,
  availability: { status: "setup-required", message: "Pair the relay" },
  urls: [],
};
const MANUAL: ServerAccessProvider = {
  id: "direct",
  displayName: "Manual",
  description: "Use your own domain or network address.",
  pluginId: null,
  routeKind: "custom",
  enabled: true,
  availability: {
    status: "setup-required",
    message: "Set a server URL reachable by machines",
  },
  urls: [],
};

function renderSettings() {
  render(
    <MemoryRouter>
      <MachineAccessSettings>
        {(pluginId) => <p>{`${pluginId} settings`}</p>}
      </MachineAccessSettings>
    </MemoryRouter>,
  );
}

function routeNames() {
  const list = screen.getByRole("list", { name: "Routes" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));
}

beforeEach(() => {
  state.mutate.mockReset();
  state.config = makeSystemConfig();
  setProviders([LAN, RELAY, MANUAL]);
});

afterEach(cleanup);

it("turns routes on and off by rewriting the disabled list", () => {
  renderSettings();
  expect(screen.getByText("relay-plugin settings")).toBeTruthy();

  fireEvent.click(screen.getByRole("switch", { name: "Use Local network" }));
  expect(state.mutate).toHaveBeenLastCalledWith({
    disabledServerAccessProviderIds: [],
  });

  fireEvent.click(screen.getByRole("switch", { name: "Use Relay" }));
  expect(state.mutate).toHaveBeenLastCalledWith({
    disabledServerAccessProviderIds: ["local-network", "relay"],
  });

  setSettings({ disabledServerAccessProviderIds: ["relay"] });
  expect(
    screen
      .getByRole("switch", { name: "Use Relay" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    screen
      .getByRole("switch", { name: "Use Local network" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.queryByText("relay-plugin settings")).toBeNull();
});

it("reorders routes by writing the full order and shows it before the server catches up", () => {
  renderSettings();
  expect(routeNames()).toEqual(["Local network", "Relay", "Manual"]);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Move Local network up",
    }).disabled,
  ).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Move Relay up" }));
  expect(state.mutate).toHaveBeenLastCalledWith({
    serverAccessOrder: ["relay", "local-network", "direct"],
  });

  setSettings({ serverAccessOrder: ["relay", "local-network", "direct"] });
  expect(routeNames()).toEqual(["Relay", "Local network", "Manual"]);

  fireEvent.click(
    screen.getByRole("button", { name: "Move Local network down" }),
  );
  expect(state.mutate).toHaveBeenLastCalledWith({
    serverAccessOrder: ["relay", "direct", "local-network"],
  });
});

it("follows a route through setup, readiness, revocation, and being turned off", () => {
  renderSettings();
  const relayRow = () => screen.getByRole("listitem", { name: "Relay" });
  expect(
    within(relayRow())
      .getByRole("link", { name: "Set up Relay" })
      .getAttribute("href"),
  ).toBe("/settings/plugins/relay-plugin");
  expect(within(relayRow()).getByText("Pair the relay")).toBeTruthy();

  setProviders([
    LAN,
    {
      ...RELAY,
      availability: {
        status: "available",
        serverUrl: "https://relay.example.com",
      },
      urls: ["https://relay.example.com"],
    },
    MANUAL,
  ]);
  expect(within(relayRow()).getByText("Ready")).toBeTruthy();
  expect(
    within(relayRow()).getByText("https://relay.example.com"),
  ).toBeTruthy();
  expect(within(relayRow()).getByRole("link", { name: "Manage" })).toBeTruthy();

  setProviders([
    LAN,
    {
      ...RELAY,
      availability: { status: "unavailable", message: "Credential revoked" },
    },
    MANUAL,
  ]);
  expect(within(relayRow()).getByText("Unavailable")).toBeTruthy();
  expect(within(relayRow()).getByText("Credential revoked")).toBeTruthy();

  setSettings({ disabledServerAccessProviderIds: ["local-network", "relay"] });
  expect(within(relayRow()).getByText("Off")).toBeTruthy();
  expect(within(relayRow()).queryByText("Credential revoked")).toBeNull();
});
