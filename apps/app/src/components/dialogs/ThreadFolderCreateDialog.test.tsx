// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadFolderRenameDialog } from "./ThreadFolderCreateDialog";

const DUPLICATE_NAME_MESSAGE = "Folder name already exists";

function RenameDialogHarness({ onRename }: { onRename: () => void }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <ThreadFolderRenameDialog
      errorMessage={errorMessage}
      target={{ id: "fld_alpha", name: "Alpha" }}
      pending={false}
      onOpenChange={() => {}}
      onRename={() => {
        onRename();
        setErrorMessage(DUPLICATE_NAME_MESSAGE);
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadFolderRenameDialog", () => {
  it("shows the same server validation error after a second submit", () => {
    const onRename = vi.fn();
    render(<RenameDialogHarness onRename={onRename} />);

    fireEvent.click(screen.getByRole("button", { name: "Rename folder" }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByText(DUPLICATE_NAME_MESSAGE)).not.toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "Beta" },
    });

    expect(screen.queryByText(DUPLICATE_NAME_MESSAGE)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rename folder" }));

    expect(onRename).toHaveBeenCalledTimes(2);
    expect(screen.getByText(DUPLICATE_NAME_MESSAGE)).not.toBeNull();
  });
});
