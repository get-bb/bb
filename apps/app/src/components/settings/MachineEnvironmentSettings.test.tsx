// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineEnvironmentList } from "@bb/server-contract";
import {
  MachineEnvironmentSettings,
  ScopedMachineEnvironmentSettings,
} from "./MachineEnvironmentSettings";

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: { projects: [{ id: "proj-a", name: "Project A" }] },
  }),
}));

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  replace: vi.fn(),
  projectList: vi.fn(),
  projectReplace: vi.fn(),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { machineGitCredentialsEnabled: true } },
  }),
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: {
      machineEnvironment: mocks.projectList,
      replaceMachineEnvironment: mocks.projectReplace,
    },
    system: {
      machineEnvironment: mocks.list,
      replaceMachineEnvironment: mocks.replace,
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    randomUUID: undefined,
  });
});

async function show(
  status: MachineEnvironmentList["builtInGit"]["status"] = "logged in",
) {
  mocks.list.mockResolvedValue({
    builtInGit: { status, statusMessage: "Git status" },
    variables: [{ name: "API_KEY", value: null, secret: true, note: null }],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MachineEnvironmentSettings />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("API_KEY");
}

it("stages additions and preserves an unchanged saved secret", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
  fireEvent.change(screen.getByLabelText("Variable name 2"), {
    target: { value: "NEW_VALUE" },
  });
  fireEvent.change(screen.getByLabelText("Value for NEW_VALUE"), {
    target: { value: "example" },
  });
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith({
      variables: [
        { name: "API_KEY", value: null, note: null },
        { name: "NEW_VALUE", value: "example", note: null },
      ],
    }),
  );
});

it("stages removal and lets users discard it without deleting", async () => {
  await show();
  fireEvent.click(screen.getByRole("button", { name: "Remove API_KEY" }));
  expect(screen.queryByDisplayValue("API_KEY")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByDisplayValue("API_KEY")).toBeTruthy();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("retains a secret replacement when saving fails", async () => {
  await show();
  mocks.replace.mockRejectedValue(new Error("offline"));
  fireEvent.change(screen.getByLabelText("Value for API_KEY"), {
    target: { value: "replacement" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
  await screen.findByText(/Some changes could not be saved/);
  expect(screen.getByDisplayValue("replacement")).toBeTruthy();
});

it("saves an empty project override without copying inherited secrets and removes it to restore inheritance", async () => {
  const inherited = { name: "REGION", value: null, secret: true, note: null };
  const view = {
    builtInGit: { status: "disabled", statusMessage: "Disabled" },
    variables: [],
    inheritedVariables: [inherited],
  };
  mocks.projectList.mockResolvedValue(view);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <ScopedMachineEnvironmentSettings projectId="project-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Override REGION" }),
  );
  expect(
    screen.queryByRole("switch", { name: "Automatic GH_TOKEN" }),
  ).toBeNull();
  mocks.projectList.mockResolvedValue({ ...view, variables: [inherited] });
  fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
  await waitFor(() =>
    expect(mocks.projectReplace).toHaveBeenCalledWith({
      projectId: "project-a",
      variables: [{ name: "REGION", value: "", note: null }],
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Value for REGION").getAttribute("placeholder"),
    ).toContain("Saved secret"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove REGION" }));
  mocks.projectList.mockResolvedValue(view);
  fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
  await waitFor(() =>
    expect(mocks.projectReplace).toHaveBeenLastCalledWith({
      projectId: "project-a",
      variables: [],
    }),
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("button", { name: "Override REGION" }),
  ).toBeTruthy();
});

function variableNameOrder(): string[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>(
      'input[aria-label^="Global variable "], input[aria-label^="Variable name "]',
    ),
  ].map((input) => input.value);
}

it("imports an inherited variable as one override and rejects partial malformed imports", async () => {
  mocks.projectList.mockResolvedValue({
    builtInGit: { status: "disabled", statusMessage: "Disabled" },
    variables: [],
    inheritedVariables: [
      { name: "REGION", value: null, secret: true, note: null },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ScopedMachineEnvironmentSettings projectId="project-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Override REGION" });
  fireEvent.click(screen.getByRole("button", { name: "Import from .env" }));
  fireEvent.change(screen.getByLabelText("Environment file contents"), {
    target: { value: 'REGION=west\nBROKEN="unfinished' },
  });
  expect(
    screen.getByRole("button", { name: "Import" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Environment file contents"), {
    target: { value: "REGION=west" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(variableNameOrder()).toEqual(["REGION"]);
  expect(screen.queryByRole("button", { name: "Override REGION" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save variables" }));
  await waitFor(() =>
    expect(mocks.projectReplace).toHaveBeenCalledWith({
      projectId: "project-a",
      variables: [{ name: "REGION", value: "west", note: null }],
    }),
  );
});

it("replaces an inherited row in place instead of appending the override", async () => {
  mocks.projectList.mockResolvedValue({
    builtInGit: { status: "disabled", statusMessage: "Disabled" },
    variables: [{ name: "ZULU", value: null, secret: true, note: null }],
    inheritedVariables: [
      { name: "ALPHA", value: null, secret: true, note: null },
      { name: "REGION", value: null, secret: true, note: null },
    ],
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <ScopedMachineEnvironmentSettings projectId="project-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Override REGION" });
  expect(variableNameOrder()).toEqual(["ALPHA", "REGION", "ZULU"]);
  fireEvent.click(screen.getByRole("button", { name: "Override REGION" }));
  expect(variableNameOrder()).toEqual(["ALPHA", "REGION", "ZULU"]);
  expect(screen.getByRole("button", { name: "Remove REGION" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Override REGION" })).toBeNull();
});
