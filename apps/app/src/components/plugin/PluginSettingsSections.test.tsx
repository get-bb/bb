// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  PluginSettingsSections,
  PluginUsageSettingsSections,
} from "./PluginSettingsSections";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

it("keeps account controls on the plugin page and removes usage when the plugin unloads", () => {
  setPluginSlotRegistrations(
    "pool",
    makePluginRegistrationSet({
      settingsSections: [
        { id: "accounts", component: () => <p>Account controls</p> },
        {
          id: "usage",
          experimental_placement: "usage",
          component: () => <p>Pool quotas</p>,
        },
      ],
    }),
  );
  const view = render(
    <MemoryRouter>
      <PluginSettingsSections pluginId="pool" />
    </MemoryRouter>,
  );
  expect(screen.getByText("Account controls")).toBeTruthy();
  expect(screen.queryByText("Pool quotas")).toBeNull();
  view.rerender(
    <MemoryRouter>
      <PluginUsageSettingsSections />
    </MemoryRouter>,
  );
  expect(screen.getByText("Pool quotas")).toBeTruthy();
  expect(screen.queryByText("Account controls")).toBeNull();
  act(() => resetPluginSlotStoreForTest());
  expect(screen.queryByText("Pool quotas")).toBeNull();
});
