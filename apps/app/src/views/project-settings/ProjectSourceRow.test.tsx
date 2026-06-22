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

  it("closes the actions menu after selecting edit local path", async () => {
    const onEditLocalPath = vi.fn();

    render(
      <ProjectSourceRow
        source={source}
        canEditLocalPath={true}
        isLocalPathInvalid={false}
        isEditPending={false}
        isOnlySource={false}
        onEditLocalPath={onEditLocalPath}
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

    expect(onEditLocalPath).toHaveBeenCalledWith(source);
    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: "Edit local path" }),
      ).toBeNull();
    });
  });
});
