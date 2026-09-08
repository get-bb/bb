// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

const mocks = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.config,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false }),
}));
afterEach(cleanup);

function show(defaultProviderId: string, paired = false) {
  mocks.config.mockReturnValue({
    data: makeSystemConfig({
      serverAccess: {
        providers: [
          {
            id: "connect",
            displayName: "bb connect",
            availability: paired
              ? { status: "available", serverUrl: "https://test.getbb.app" }
              : { status: "setup-required", message: "Set up bb connect" },
            attention: paired ? "2 legacy access records need attention" : null,
          },
          {
            id: "direct",
            displayName: "Manual",
            availability: { status: "available" },
            attention: null,
          },
        ],
        defaultProviderId,
        effectiveUrl: "https://bb.example.com",
        urlSource: "BB_EXTERNAL_URL",
      },
    }),
  });
  render(
    <MemoryRouter>
      <MachineAccessSettings />
    </MemoryRouter>,
  );
}

it("offers Connect setup without exposing the manual URL even when a URL exists", () => {
  show("connect");
  expect(
    screen
      .getByRole("link", { name: "Set up bb connect" })
      .getAttribute("href"),
  ).toBe("/settings/plugins/connect");
  expect(screen.getByText("Not connected")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("Automatic")).toBeNull();
});

it("shows the URL input only for Manual", () => {
  show("direct");
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Set up bb connect" })).toBeNull();
});

it("retains diagnostics for paired Connect without showing setup", () => {
  show("connect", true);
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "https://test.getbb.app" })
      .getAttribute("href"),
  ).toBe("https://test.getbb.app");
  expect(
    screen.getByRole("link", { name: "Manage" }).getAttribute("href"),
  ).toBe("/settings/plugins/connect");
  expect(screen.getByRole("status").textContent).toBe(
    "bb connect: 2 legacy access records need attention",
  );
  expect(screen.queryByRole("link", { name: "Set up bb connect" })).toBeNull();
});
