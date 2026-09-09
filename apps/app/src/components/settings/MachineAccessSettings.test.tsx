// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  mutate: vi.fn(),
  isPending: false,
}));
vi.mock("@/components/pickers/OptionPicker", () => ({
  OptionPicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label="Connection method"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="connect">bb connect</option>
      <option value="direct">Manual</option>
    </select>
  ),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.config,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({
    isPending: mocks.isPending,
    mutate: mocks.mutate,
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.isPending = false;
});

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
  return render(
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

it("keeps the selection through saving and a stale config refresh", () => {
  const view = show("connect");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "direct" },
  });
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  expect(mocks.mutate.mock.calls[0][0].defaultMachineAccess).toBe("direct");
  const refresh = () =>
    view.rerender(
      <MemoryRouter>
        <MachineAccessSettings />
      </MemoryRouter>,
    );
  mocks.isPending = true;
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("direct");
  mocks.isPending = false;
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("direct");
  const config = mocks.config();
  mocks.config.mockReturnValue({
    data: {
      ...config.data,
      serverAccess: {
        ...config.data.serverAccess,
        defaultProviderId: "direct",
      },
    },
  });
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("direct");
  mocks.config.mockReturnValue(config);
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("connect");
});

it("restores the saved selection when saving fails", () => {
  show("connect");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "direct" },
  });
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  act(() => mocks.mutate.mock.calls[0][1].onError(new Error("Save failed")));
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("connect");
  expect(screen.queryByRole("textbox", { name: "Server address" })).toBeNull();
});
