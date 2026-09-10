// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RenameDialog, RenameDialogContent } from "./RenameDialog";

function RenameDialogHarness({ open }: { open: boolean }) {
  return (
    <>
      <textarea aria-label="Composer" />
      <RenameDialog open={open} onOpenChange={vi.fn()}>
        {(inputRef) => (
          <RenameDialogContent
            entityLabel="thread"
            initialName="Current title"
            pending={false}
            autoCapitalize="sentences"
            onRename={vi.fn()}
            inputRef={inputRef}
          />
        )}
      </RenameDialog>
    </>
  );
}

afterEach(cleanup);

it("restores focus after a programmatically opened rename dialog closes", async () => {
  const view = render(<RenameDialogHarness open={false} />);
  const composer = screen.getByRole("textbox", { name: "Composer" });
  composer.focus();

  view.rerender(<RenameDialogHarness open />);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Thread name" }),
    ),
  );

  view.rerender(<RenameDialogHarness open={false} />);
  await waitFor(() => expect(document.activeElement).toBe(composer));
});
