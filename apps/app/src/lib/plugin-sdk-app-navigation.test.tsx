// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandHandler,
} from "@/components/commands/AppCommandProvider";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

vi.mock("@/hooks/queries/system-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/system-queries")>()),
  useSystemConfig: () => ({
    data: { generalSettings: { ...defaultAppSettings } },
  }),
}));

afterEach(cleanup);

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.hash}`}</div>
  );
}

function NavigateProbe({
  action,
  results,
}: {
  action: (
    navigate: ReturnType<typeof pluginSdkAppImplementation.useBbNavigate>,
  ) => boolean;
  results: boolean[];
}) {
  const navigate = pluginSdkAppImplementation.useBbNavigate();
  return (
    <button type="button" onClick={() => results.push(action(navigate))}>
      Run
    </button>
  );
}

function PaletteHandler({ onRun }: { onRun: () => void }) {
  useAppCommandHandler("palette.open", () => {
    onRun();
    return true;
  });
  return null;
}

function renderProbe(
  action: (
    navigate: ReturnType<typeof pluginSdkAppImplementation.useBbNavigate>,
  ) => boolean,
  onPaletteOpen: () => void = () => {},
) {
  const results: boolean[] = [];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/"]}>
        <AppCommandProvider>
          <PaletteHandler onRun={onPaletteOpen} />
          <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
            <NavigateProbe action={action} results={results} />
          </PluginSlotMount>
          <LocationProbe />
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  return results;
}

describe("plugin SDK app routes and commands", () => {
  it("navigates to an in-app route with its hash", () => {
    const results = renderProbe((navigate) =>
      navigate.experimental_openAppRoute("/settings/updates#whats-new"),
    );
    expect(results).toEqual([true]);
    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/updates#whats-new",
    );
  });

  it("refuses an external URL without navigating", () => {
    const results = renderProbe((navigate) =>
      navigate.experimental_openAppRoute("https://example.com/settings"),
    );
    expect(results).toEqual([false]);
    expect(screen.getByTestId("location").textContent).toBe("/");
  });

  it("runs a built-in app command through its registered handler", () => {
    const onPaletteOpen = vi.fn();
    const results = renderProbe(
      (navigate) => navigate.experimental_runAppCommand("palette.open"),
      onPaletteOpen,
    );
    expect(results).toEqual([true]);
    expect(onPaletteOpen).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown, state-changing, and plugin command ids", () => {
    const onPaletteOpen = vi.fn();
    const results = renderProbe(
      (navigate) =>
        navigate.experimental_runAppCommand("palette.explode") ||
        navigate.experimental_runAppCommand("thread.archive") ||
        navigate.experimental_runAppCommand("question.select.1") ||
        navigate.experimental_runAppCommand("plugins.enterSafeMode") ||
        navigate.experimental_runAppCommand("plugin:demo/palette"),
      onPaletteOpen,
    );
    expect(results).toEqual([false]);
    expect(onPaletteOpen).not.toHaveBeenCalled();
  });

  it("reports false when no handler is mounted for the command", () => {
    const results = renderProbe((navigate) =>
      navigate.experimental_runAppCommand("thread.search"),
    );
    expect(results).toEqual([false]);
  });
});
