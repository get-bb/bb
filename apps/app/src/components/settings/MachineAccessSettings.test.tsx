// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

import {
  setPluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

const state = vi.hoisted(() => ({
  config: undefined as ReturnType<typeof makeSystemConfig> | undefined,
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: state.config }),
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false }),
}));

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

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
  const view = () => (
    <MemoryRouter>
      <MachineAccessSettings />
    </MemoryRouter>
  );
  const rendered = render(view());
  expect(screen.getByText("Pair the relay")).toBeTruthy();
  const registration = makePluginRegistrationSet({
    serverAccess: [
      {
        id: "inline",
        providerId: "relay",
        component: ({ purpose }) => <p>Inline setup for {purpose}</p>,
      },
    ],
  });
  act(() => setPluginSlotRegistrations("other-plugin", registration));
  expect(screen.queryByText("Inline setup for machines")).toBeNull();
  act(() => setPluginSlotRegistrations("relay-plugin", registration));
  expect(screen.getByText("Inline setup for machines")).toBeTruthy();
  expect(screen.queryByText("Pair the relay")).toBeNull();
  act(() =>
    setPluginSlotRegistrations("relay-plugin", makePluginRegistrationSet()),
  );
  expect(screen.getByText("Pair the relay")).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
  const provider = state.config.serverAccess.providers[0]!;
  provider.availability = {
    status: "available",
    serverUrl: "https://relay.example.com",
  };
  rendered.rerender(view());
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText("https://relay.example.com")).toBeTruthy();
  provider.availability = {
    status: "unavailable",
    message: "Credential revoked",
  };
  rendered.rerender(view());
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText("Credential revoked")).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
  provider.availability = { status: "available" };
  rendered.rerender(view());
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText("Ready to add machines.")).toBeTruthy();
  state.config.serverAccess.providers = [];
  rendered.rerender(view());
  expect(
    screen.getByText("This connection method is not installed."),
  ).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
});
