// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { LocalPathProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSourceRow } from "./ProjectSourceRow";

const source: LocalPathProjectSource = {
  id: "src_test",
  projectId: "proj_test",
  type: "local_path",
  hostId: "host_test",
  path: "/tmp/test-project",
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

describe("ProjectSourceRow", () => {
  afterEach(cleanup);

  it("shows the source's machine with its connection status", () => {
    render(
      <ProjectSourceRow
        source={source}
        machine={{ name: "Mac Studio", connected: true }}
        canEditLocalPath={false}
        isLocalPathInvalid={false}
        isEditPending={false}
        isOnlySource={false}
        onEditLocalPath={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("Mac Studio")).toBeDefined();
    expect(screen.getByText("/tmp/test-project")).toBeDefined();
    expect(screen.queryByText("offline")).toBeNull();
  });

  it("labels the row offline when the machine is disconnected", () => {
    render(
      <ProjectSourceRow
        source={source}
        machine={{ name: "dev-vm", connected: false }}
        canEditLocalPath={false}
        isLocalPathInvalid={false}
        isEditPending={false}
        isOnlySource={false}
        onEditLocalPath={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("dev-vm")).toBeDefined();
    expect(screen.getByText("offline")).toBeDefined();
  });

  it("closes the actions menu after selecting edit local path", async () => {
    render(
      <ProjectSourceRow
        source={source}
        machine={null}
        canEditLocalPath={true}
        isLocalPathInvalid={false}
        isEditPending={false}
        isOnlySource={false}
        onEditLocalPath={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Source actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Edit local path" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "Edit local path" }),
      ).toBeNull();
    });
  });
});
