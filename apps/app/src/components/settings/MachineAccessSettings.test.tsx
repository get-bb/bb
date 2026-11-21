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
import { MemoryRouter, useLocation } from "react-router-dom";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  MachineAccessSettings,
  MobileServerAccess,
} from "./MachineAccessSettings";

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

function CurrentPath() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderSettings() {
  render(
    <MemoryRouter>
      <MachineAccessSettings />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function namesIn(listName: string) {
  const list = screen.queryByRole("list", { name: listName });
  if (list === null) return [];
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));
}

function ready(provider: ServerAccessProvider, url: string) {
  return {
    ...provider,
    availability: { status: "available" as const, serverUrl: url },
    urls: [url],
  };
}

beforeEach(() => {
  state.mutate.mockReset();
  state.config = makeSystemConfig();
  setProviders([LAN, RELAY, MANUAL]);
});

afterEach(cleanup);

async function addRoute(name: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Add a route" }), {
    button: 0,
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: new RegExp(name) }),
  );
}

it("lists routes that are on and offers the rest from Add a route", async () => {
  renderSettings();
  expect(namesIn("Routes")).toEqual([]);
  expect(screen.getByText(/Only this computer can reach bb/)).toBeTruthy();

  await addRoute("Local network");
  expect(state.mutate).toHaveBeenLastCalledWith({
    disabledServerAccessProviderIds: [],
  });

  setSettings({ disabledServerAccessProviderIds: [] });
  setProviders([
    ready(LAN, "http://10.0.0.5:1"),
    ready(RELAY, "https://r.example"),
    MANUAL,
  ]);
  expect(namesIn("Routes")).toEqual(["Local network", "Relay"]);
  expect(
    screen
      .getAllByRole("button", { name: /^Reorder / })
      .map((handle) => handle.getAttribute("aria-label")),
  ).toEqual(["Reorder Local network", "Reorder Relay"]);

  fireEvent.click(screen.getByRole("button", { name: "Turn off Relay" }));
  expect(state.mutate).toHaveBeenLastCalledWith({
    disabledServerAccessProviderIds: ["relay"],
  });

  setSettings({ serverAccessOrder: ["relay", "direct", "local-network"] });
  expect(namesIn("Routes")).toEqual(["Relay", "Local network"]);
});

it("offers reordering only once two routes are on", () => {
  setSettings({ disabledServerAccessProviderIds: [] });
  setProviders([ready(LAN, "http://10.0.0.5:1"), RELAY, MANUAL]);
  renderSettings();
  expect(namesIn("Routes")).toEqual(["Local network"]);
  expect(screen.queryByRole("button", { name: /^Reorder / })).toBeNull();
});

it("opens a Manual address editor when Manual is added", async () => {
  renderSettings();
  expect(screen.queryByRole("textbox", { name: "Server address" })).toBeNull();
  await addRoute("Manual");
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("textbox", { name: "Server address" })).toBeNull();
});

it("follows a plugin route through setup, readiness, failure, and being turned off", async () => {
  renderSettings();
  await addRoute("Relay");
  expect(screen.getByTestId("path").textContent).toBe(
    "/settings/plugins/relay-plugin",
  );

  setProviders([LAN, ready(RELAY, "https://relay.example.com"), MANUAL]);
  const relayRow = () => screen.getByRole("listitem", { name: "Relay" });
  expect(namesIn("Routes")).toEqual(["Relay"]);
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
  expect(namesIn("Routes")).toEqual(["Relay"]);
  expect(within(relayRow()).getByText("Credential revoked")).toBeTruthy();
  expect(within(relayRow()).getByRole("link", { name: "Fix" })).toBeTruthy();

  setSettings({ disabledServerAccessProviderIds: ["local-network", "relay"] });
  expect(namesIn("Routes")).toEqual([]);
  await addRoute("Relay");
  expect(state.mutate).toHaveBeenLastCalledWith({
    disabledServerAccessProviderIds: ["local-network"],
  });
});

it("shows the phone only ready routes, and plugin sections for routes that are on", () => {
  render(
    <MemoryRouter>
      <MobileServerAccess
        renderPluginSettings={(pluginId) => <p>{`${pluginId} pairing`}</p>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/No route is ready yet/)).toBeTruthy();
  expect(screen.getByText("relay-plugin pairing")).toBeTruthy();

  setProviders([
    {
      ...LAN,
      availability: { status: "available", serverUrl: "http://10.0.0.5:1" },
      urls: ["http://10.0.0.5:1"],
    },
    {
      ...RELAY,
      availability: { status: "available", serverUrl: "https://r.example" },
      urls: ["https://r.example"],
    },
    MANUAL,
  ]);
  setSettings({ disabledServerAccessProviderIds: [] });
  const ready = screen.getByRole("list", { name: "Ready routes" });
  expect(
    within(ready)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Local networkhttp://10.0.0.5:1", "Relayhttps://r.example"]);

  setSettings({ disabledServerAccessProviderIds: ["relay"] });
  expect(screen.queryByText("relay-plugin pairing")).toBeNull();
  expect(
    within(screen.getByRole("list", { name: "Ready routes" }))
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual(["Local network"]);
});
