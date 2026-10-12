// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act } from "react";
import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@bb/shared-ui/action-menu-items";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  ProjectActionsMenuItems,
  ProjectActionsMenu,
} from "./ProjectActionsMenu";
import { makeProjectResponse } from "@/test/fixtures/projects";

const actionClients = vi.hoisted(() => ({ sdk: {}, navigate: {} }));
vi.mock("@/lib/plugin-sdk-hooks", () => ({
  useSdk: () => actionClients.sdk,
  useBbNavigate: () => actionClients.navigate,
}));

const mockPathPickerHost = vi.hoisted(() => ({
  value: { hostId: null as string | null, hostName: null as string | null },
}));

const mockProjectActions = vi.hoisted(() => ({
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
  requestAddLocalPath: vi.fn(),
}));

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => mockPathPickerHost.value,
}));

vi.mock("./ProjectActionsProvider", () => ({
  useProjectActions: () => mockProjectActions,
}));

describe("ProjectActionsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    resetPluginSlotStoreForTest();
    mockPathPickerHost.value = { hostId: null, hostName: null };
  });

  it("closes after selecting an action", async () => {
    const project = makeProjectResponse();

    render(
      <MemoryRouter>
        <ProjectActionsMenu project={project} />
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Test project actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });
  });
});

const project = makeProjectResponse();
function listExtras(surface: "dropdown" | "context") {
  return (
    <>
      <ActionMenuSeparator surface={surface} />
      <ActionMenuItem surface={surface} icon="EyeOff">
        Hide from list
      </ActionMenuItem>
      <ActionMenuItem surface={surface} icon="Settings">
        Customize list
      </ActionMenuItem>
    </>
  );
}
const surfaces = [
  {
    name: "core dropdown",
    surface: "dropdown" as const,
    items: () => (
      <ProjectActionsMenuItems
        project={project}
        surface="dropdown"
        extraActions={listExtras}
      />
    ),
  },
  {
    name: "core context",
    surface: "context" as const,
    items: () => (
      <ProjectActionsMenuItems
        project={project}
        surface="context"
        extraActions={listExtras}
      />
    ),
  },
];

async function openSurface(surface: (typeof surfaces)[number]) {
  render(
    <MemoryRouter>
      {surface.surface === "dropdown" ? (
        <DropdownMenu>
          <DropdownMenuTrigger>Open project</DropdownMenuTrigger>
          <DropdownMenuContent>{surface.items()}</DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger>Open project</ContextMenuTrigger>
          <ContextMenuContent>{surface.items()}</ContextMenuContent>
        </ContextMenu>
      )}
    </MemoryRouter>,
  );
  if (surface.surface === "dropdown")
    fireEvent.pointerDown(screen.getByText("Open project"), { button: 0 });
  else
    fireEvent.contextMenu(screen.getByText("Open project"), {
      clientX: 10,
      clientY: 10,
    });
  await screen.findByRole("menuitem", { name: "Rename" });
}

function registerAction(
  pluginId: string,
  label: string,
  run: () => void | Promise<void>,
  order?: number,
) {
  const item = vi.fn(
    (
      _input: import("@get-bb/plugin-sdk").experimental_ProjectActionItemInput,
    ) => {
      return { label, icon: "FileText" as const, run };
    },
  );
  setPluginSlotRegistrations(
    pluginId,
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_projectAction({ id: "handoff", order, item });
      }),
    ),
  );
  return item;
}

describe.each(surfaces)("project contribution contract: $name", (surface) => {
  afterEach(() => {
    cleanup();
    resetPluginSlotStoreForTest();
    vi.restoreAllMocks();
  });

  it("renders ordered contributions in the project group before list actions and activates with the selected project", async () => {
    const run = vi.fn();
    registerAction("z-plugin", "Last handoff", run);
    registerAction("b-plugin", "Second handoff", run, 5);
    const item = registerAction("a-plugin", "First handoff", run, 5);
    await openSurface(surface);
    expect(item).toHaveBeenCalledWith({
      project: { id: project.id, name: project.name },
      sdk: actionClients.sdk,
      navigate: actionClients.navigate,
    });
    const labels = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(labels.indexOf("First handoff")).toBeLessThan(
      labels.indexOf("Second handoff"),
    );
    expect(labels.indexOf("Second handoff")).toBeLessThan(
      labels.indexOf("Last handoff"),
    );
    expect(labels.indexOf("Last handoff")).toBeLessThan(
      labels.indexOf("Remove"),
    );
    expect(labels).toEqual([
      "Project settings",
      "Rename",
      "First handoff",
      "Second handoff",
      "Last handoff",
      "Hide from list",
      "Customize list",
      "Remove",
    ]);
    expect(
      screen
        .getByRole("menuitem", { name: "Last handoff" })
        .nextElementSibling?.getAttribute("role"),
    ).toBe("separator");
    expect(
      screen
        .getByRole("menuitem", { name: "Remove" })
        .previousElementSibling?.getAttribute("role"),
    ).toBe("separator");
    fireEvent.click(screen.getByRole("menuitem", { name: "First handoff" }));
    expect(run).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "First handoff" }),
      ).toBeNull(),
    );
  });

  it("hides unavailable items, disables entries, and isolates factory failures", async () => {
    const run = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "conditional",
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.slots.experimental_projectAction({
            id: "hidden",
            item: ({ project: target }) =>
              target.id === project.id
                ? null
                : { label: "Hidden handoff", icon: "FileText", run },
          });
          app.slots.experimental_projectAction({
            id: "broken",
            item: () => {
              throw new Error("factory failed");
            },
          });
          app.slots.experimental_projectAction({
            id: "disabled",
            item: () => ({
              label: "Disabled handoff",
              icon: "FileText",
              disabled: true,
              run,
            }),
          });
        }),
      ),
    );
    await openSurface(surface);
    expect(screen.queryByText("Hidden handoff")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Disabled handoff" }));
    expect(run).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'project action "conditional/broken" item failed',
      expect.any(Error),
    );
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeTruthy();
  });

  it.each(["sync", "async"])(
    "contains %s activation errors",
    async (failure) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      registerAction("failing", "Failing handoff", () => {
        if (failure === "sync") throw new Error("run failed");
        return Promise.reject(new Error("run failed"));
      });
      await openSurface(surface);
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Failing handoff" }),
      );
      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'project action "failing/handoff" failed',
          expect.any(Error),
        ),
      );
    },
  );

  it("replaces reloaded actions and removes disabled/uninstalled contributions from an open menu", async () => {
    const oldRun = vi.fn();
    registerAction("reloadable", "Old handoff", oldRun);
    await openSurface(surface);
    const newRun = vi.fn();
    act(() => {
      registerAction("reloadable", "New handoff", newRun);
    });
    expect(screen.queryByRole("menuitem", { name: "Old handoff" })).toBeNull();
    expect(
      screen.getAllByRole("menuitem", { name: "New handoff" }),
    ).toHaveLength(1);
    act(() => {
      removePluginSlotRegistrations("reloadable");
    });
    expect(screen.queryByRole("menuitem", { name: "New handoff" })).toBeNull();
    expect(oldRun).not.toHaveBeenCalled();
    expect(newRun).not.toHaveBeenCalled();
  });
});
