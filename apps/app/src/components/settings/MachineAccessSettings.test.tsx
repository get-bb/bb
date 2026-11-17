// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

type SystemConfig = ReturnType<typeof makeSystemConfig>;
type ServerAccessProvider = SystemConfig["serverAccess"]["providers"][number];

const state = vi.hoisted(() => ({
  config: undefined as ReturnType<typeof makeSystemConfig> | undefined,
  listeners: new Set<() => void>(),
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

function setProviders(providers: ServerAccessProvider[]) {
  const config = state.config!;
  act(() => {
    state.config = {
      ...config,
      serverAccess: { ...config.serverAccess, providers },
    };
    for (const listener of state.listeners) listener();
  });
}
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false }),
}));

afterEach(cleanup);

it("follows access availability through setup, readiness, revocation, and recovery", () => {
  state.config = makeSystemConfig({
    serverAccess: {
      defaultProviderId: "relay",
      effectiveUrl: null,
      urlSource: null,
      providers: [
        {
          id: "relay",
          displayName: "Relay",
          description: "A relay",
          pluginId: "relay-plugin",
          availability: { status: "setup-required", message: "Pair the relay" },
        },
      ],
    },
  });
  render(
    <MemoryRouter>
      <MachineAccessSettings />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("link", { name: "Set up Relay" }).getAttribute("href"),
  ).toBe("/settings/plugins/relay-plugin");
  expect(screen.queryByText("Ready")).toBeNull();
  const provider = state.config.serverAccess.providers[0]!;
  setProviders([
    {
      ...provider,
      availability: {
        status: "available",
        serverUrl: "https://relay.example.com",
      },
    },
  ]);
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText("https://relay.example.com")).toBeTruthy();
  setProviders([
    {
      ...provider,
      availability: { status: "unavailable", message: "Credential revoked" },
    },
  ]);
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText("Credential revoked")).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
  setProviders([{ ...provider, availability: { status: "available" } }]);
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText("Ready to connect devices.")).toBeTruthy();
  setProviders([]);
  expect(
    screen.getByText(
      "This connection method is not installed. Choose another method above.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
});
