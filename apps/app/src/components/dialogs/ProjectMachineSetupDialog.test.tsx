// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/api";
import {
  ProjectMachineSetupDialog,
  type ProjectMachineSetupDialogTarget,
} from "./ProjectMachineSetupDialog";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getHostCloneDefaultPath: vi.fn(),
    addProjectSource: vi.fn(),
    browseHostDirectory: vi.fn(),
    checkHostPathsExist: vi.fn(),
  };
});

const api = vi.mocked(await import("@/lib/api"));

const DEFAULT_CLONE_PATH = "/Users/me/bb/checkouts/bb";

const gitTarget: ProjectMachineSetupDialogTarget = {
  projectId: "proj_test",
  projectName: "bb",
  gitRemoteUrl: "git@github.com:sawyerhood/bb.git",
  hostId: "host_studio",
  hostName: "Mac Studio",
};

const createdSource: ProjectSource = {
  id: "src_new",
  projectId: "proj_test",
  type: "local_path",
  hostId: "host_studio",
  path: DEFAULT_CLONE_PATH,
  isDefault: false,
  createdAt: 0,
  updatedAt: 0,
};

function renderDialog(target: ProjectMachineSetupDialogTarget) {
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProjectMachineSetupDialog
        target={target}
        onOpenChange={onOpenChange}
        onComplete={onComplete}
      />
    </QueryClientProvider>,
  );
  return { onComplete, onOpenChange };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectMachineSetupDialog", () => {
  it("defaults to cloning from the remote into the host's default path", async () => {
    api.getHostCloneDefaultPath.mockResolvedValue(DEFAULT_CLONE_PATH);
    api.addProjectSource.mockResolvedValue(createdSource);
    const { onComplete } = renderDialog(gitTarget);

    expect(screen.getByText("Set up bb on Mac Studio")).toBeTruthy();
    expect(screen.getByText(gitTarget.gitRemoteUrl!)).toBeTruthy();
    expect(
      screen.getByText("Use an existing folder on Mac Studio"),
    ).toBeTruthy();
    expect(await screen.findByText(DEFAULT_CLONE_PATH)).toBeTruthy();

    fireEvent.submit(
      screen.getByRole("button", { name: "Clone & continue" }).closest("form")!,
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    // No targetPath when the default destination is untouched — the daemon
    // derives the same path itself.
    expect(api.addProjectSource).toHaveBeenCalledWith("proj_test", {
      type: "clone",
      hostId: "host_studio",
    });
    expect(onComplete).toHaveBeenCalledWith({
      hostId: "host_studio",
      source: createdSource,
    });
  });

  it("sends the edited destination as targetPath", async () => {
    api.getHostCloneDefaultPath.mockResolvedValue(DEFAULT_CLONE_PATH);
    api.addProjectSource.mockResolvedValue(createdSource);
    renderDialog(gitTarget);
    await screen.findByText(DEFAULT_CLONE_PATH);

    fireEvent.click(screen.getByRole("button", { name: "change" }));
    fireEvent.change(screen.getByLabelText("Clone destination"), {
      target: { value: "/Users/me/elsewhere/bb" },
    });
    fireEvent.keyDown(screen.getByLabelText("Clone destination"), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("button", { name: "Clone & continue" }));

    await waitFor(() => expect(api.addProjectSource).toHaveBeenCalled());
    expect(api.addProjectSource).toHaveBeenCalledWith("proj_test", {
      type: "clone",
      hostId: "host_studio",
      targetPath: "/Users/me/elsewhere/bb",
    });
  });

  it("shows the clone error verbatim and allows retrying", async () => {
    api.getHostCloneDefaultPath.mockResolvedValue(DEFAULT_CLONE_PATH);
    const gitStderr =
      "git clone failed: fatal: could not read Username for 'https://github.com'";
    api.addProjectSource.mockRejectedValue(
      new HttpError({ status: 502, code: "git_command_failed", message: gitStderr }),
    );
    renderDialog(gitTarget);
    await screen.findByText(DEFAULT_CLONE_PATH);

    fireEvent.click(screen.getByRole("button", { name: "Clone & continue" }));

    expect(await screen.findByText(gitStderr)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Clone & continue" });
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("suggests another path or the folder option when the target is not empty", async () => {
    api.getHostCloneDefaultPath.mockResolvedValue(DEFAULT_CLONE_PATH);
    api.addProjectSource.mockRejectedValue(
      new HttpError({
        status: 409,
        code: "target_not_empty",
        message: "Target directory is not empty",
      }),
    );
    renderDialog(gitTarget);
    await screen.findByText(DEFAULT_CLONE_PATH);

    fireEvent.click(screen.getByRole("button", { name: "Clone & continue" }));

    expect(
      await screen.findByText("Target directory is not empty"),
    ).toBeTruthy();
    expect(
      screen.getByText(/use the existing-folder option/u),
    ).toBeTruthy();
  });

  it("submits an existing browsed folder as a local_path source", async () => {
    api.getHostCloneDefaultPath.mockResolvedValue(DEFAULT_CLONE_PATH);
    api.browseHostDirectory.mockResolvedValue({
      directory: "/Users/me/code/bb",
      parent: "/Users/me/code",
      entries: [],
    });
    api.checkHostPathsExist.mockResolvedValue({ "/Users/me/code/bb": true });
    api.addProjectSource.mockResolvedValue({
      ...createdSource,
      path: "/Users/me/code/bb",
    });
    const { onComplete } = renderDialog(gitTarget);

    fireEvent.click(
      screen.getByText("Use an existing folder on Mac Studio"),
    );
    // The browser resolves the initial (home) listing as the picked folder.
    await screen.findByText("This folder is empty.");
    const submit = await screen.findByRole("button", {
      name: "Use folder & continue",
    });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));

    fireEvent.click(submit);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(api.addProjectSource).toHaveBeenCalledWith("proj_test", {
      type: "local_path",
      hostId: "host_studio",
      path: "/Users/me/code/bb",
    });
  });

  it("offers only the folder option for a project without a git remote", () => {
    api.browseHostDirectory.mockResolvedValue({
      directory: "/Users/me",
      parent: null,
      entries: [],
    });
    renderDialog({ ...gitTarget, gitRemoteUrl: null });

    expect(screen.queryByText("Clone from the project remote")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Use folder & continue" }),
    ).toBeTruthy();
  });
});
