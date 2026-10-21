// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { makeHost as host } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import { sdk } from "@/lib/sdk";
import { ProjectPathDialog } from "./ProjectPathDialog";

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { directory: vi.fn() } },
}));

vi.mock("@/components/dialogs/RemotePathBrowser", () => ({
  RemotePathBrowser: ({
    hostId,
    allowCreateFolder,
    onDirectoryChange,
  }: {
    hostId: string;
    allowCreateFolder: boolean;
    onDirectoryChange: (directory: string) => void;
  }) => (
    <button
      type="button"
      data-allow-create-folder={String(allowCreateFolder)}
      onClick={() =>
        onDirectoryChange(
          hostId === "host_kunst"
            ? "/Users/amadad/projects/reachy_mini"
            : hostId === "host_long"
              ? `/home/deploy/repos/${"long-project-name-".repeat(20)}`
              : "/home/deploy/repos/givecare",
        )
      }
    >
      Choose folder on {hostId}
    </button>
  ),
}));

const atum = host({ id: "host_atum", name: "atum" });
const kunst = host({ id: "host_kunst", name: "Kunst" });
const offline = host({
  id: "host_offline",
  name: "Offline Mac",
  status: "disconnected",
});
const offlineKunst = host({ ...kunst, status: "disconnected" });

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("ProjectPathDialog machine selection", () => {
  it("creates a project from a folder on the selected connected machine", async () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum, kunst, offline]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Machine" });
    expect(trigger.textContent).toContain("atum");
    expect(
      screen
        .getByRole("button", { name: "Choose folder on host_atum" })
        .getAttribute("data-allow-create-folder"),
    ).toBe("true");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      screen
        .getByRole("menuitem", { name: /Offline Mac/u })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: /Kunst/u }));
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_kunst" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { kind: "create" },
        "/Users/amadad/projects/reachy_mini",
        "host_kunst",
      ),
    );
  });

  it("preserves the direct single-machine folder flow", async () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "Machine" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { kind: "create" },
        "/home/deploy/repos/givecare",
        "host_atum",
      ),
    );
  });

  it("includes provider-made hosts in the project setup machine picker", () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[
          atum,
          kunst,
          host({
            id: "host_modal",
            name: "Modal sandbox 3f9a",
            type: "ephemeral",
            machineProviderId: "modal",
          }),
        ]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Machine" }), {
      button: 0,
    });

    expect(screen.getByRole("menuitem", { name: /Kunst/u })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Modal sandbox 3f9a/u }),
    ).toBeTruthy();
  });

  it("blocks submission when every listed machine is offline", () => {
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={null}
        hostName={null}
        hosts={[offline, offlineKunst]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText("Project path")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Add project" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ProjectPathDialog missing folders", () => {
  it.each([
    { target: { kind: "create" as const }, label: "Add project" },
    {
      target: {
        kind: "add-source" as const,
        projectId: "project-example",
        projectName: "Example",
      },
      label: "Add source",
    },
  ])("refuses a folder deleted before $label", async ({ target, label }) => {
    vi.mocked(sdk.hosts.directory).mockRejectedValue(
      new BbHttpError({
        status: 502,
        code: "ENOENT",
        message: "Folder not found",
        body: { code: "ENOENT", message: "Folder not found" },
      }),
    );
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={target}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: label }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This folder isn't on atum. It may have been moved or deleted.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Choose another folder" }),
    ).toBeTruthy();
  });
});

it.each(["EACCES", "host_unavailable", "command_timeout"])(
  "still saves when the directory check returns %s",
  async (code) => {
    vi.mocked(sdk.hosts.directory).mockRejectedValue(
      new BbHttpError({ status: 502, code, message: code, body: { code } }),
    );
    const onSubmit = vi.fn();
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        hostId={atum.id}
        hostName={atum.name}
        hosts={[atum]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose folder on host_atum" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

it("does not save after closing a dialog with a directory check in flight", async () => {
  let resolveCheck: (() => void) | undefined;
  vi.mocked(sdk.hosts.directory).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveCheck = () =>
          resolve({
            directory: "/work/projects/example",
            parent: "/work/projects",
            entries: [],
            roots: ["/"],
          });
      }),
  );
  const onSubmit = vi.fn();
  const { unmount } = render(
    <ProjectPathDialog
      target={{ kind: "create" }}
      platform="linux"
      hostId={atum.id}
      hostName={atum.name}
      hosts={[atum]}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose folder on host_atum" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  expect(sdk.hosts.directory).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => resolveCheck?.());
  expect(onSubmit).not.toHaveBeenCalled();
});
