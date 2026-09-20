// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import {
  SidebarRenameProvider,
  useSidebarRename,
  useSidebarRenameState,
} from "./SidebarInlineRename";

afterEach(cleanup);

function RenameRow({
  id = "first",
  name = "Original name",
  onSave,
  onClear,
  kind = "thread",
  maxLength,
}: {
  id?: string;
  name?: string;
  onSave: (name: string) => Promise<unknown>;
  onClear?: () => Promise<unknown>;
  kind?: "thread" | "section" | "environment";
  maxLength?: number;
}) {
  const rename = useSidebarRename({
    kind,
    id,
    name,
    label: `${id} name`,
    ownerKey: id,
    onSave,
    onClear,
    maxLength,
  });
  return (
    <div data-sidebar-rename-row="">
      <button data-sidebar-rename-anchor="" onClick={rename.startEditing}>
        Rename {id}
      </button>
      {rename.isEditing ? rename.editor : <span>{name}</span>}
    </div>
  );
}

function SessionState() {
  const state = useSidebarRenameState();
  return <output aria-label="Active rename">{state?.id ?? "none"}</output>;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function start(value = "New name") {
  fireEvent.click(screen.getByRole("button", { name: "Rename first" }));
  const input = await screen.findByRole("textbox", { name: "first name" });
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("sidebar inline rename", () => {
  it("selects the current name and restores row focus after Escape without saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename first" }));
    const input = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "first name",
    });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Original name".length);
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Rename first" }),
      ),
    );
  });

  it("saves a trimmed value once while Enter and blur overlap, and cannot cancel an in-flight save", async () => {
    const pending = deferred();
    const onSave = vi.fn().mockReturnValue(pending.promise);
    render(<RenameRow onSave={onSave} />);
    const input = await start("  New name  ");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledExactlyOnceWith("New name"),
    );
    expect(screen.getByRole("status", { name: "Saving name" })).not.toBeNull();
    expect(screen.getByRole("textbox").getAttribute("readonly")).toBe("");
    await act(async () => pending.resolve());
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("validates empty and overlong values and treats a trimmed unchanged name as a no-op", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow onSave={onSave} maxLength={20} />);
    const input = await start("   ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("Name cannot be empty.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "A name that is too long" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Name must be 20 characters or fewer.",
    );
    fireEvent.change(input, { target: { value: " Original name " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not submit composition Enter or blur within the editor; pointer Cancel wins", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow onSave={onSave} />);
    const input = await start();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.compositionEnd(input);
    fireEvent.blur(input, {
      relatedTarget: screen.getByRole("button", { name: "Save name" }),
    });
    const cancel = screen.getByRole("button", { name: "Cancel rename" });
    expect(fireEvent.pointerDown(cancel)).toBe(false);
    fireEvent.click(cancel, { detail: 1 });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("retains a rejected draft and retries with the same value", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(undefined);
    render(<RenameRow onSave={onSave} />);
    fireEvent.keyDown(await start(), { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Could not save the name. Try again.",
      ),
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "New name",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry saving name" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onSave.mock.calls).toEqual([["New name"], ["New name"]]);
  });

  it("uses the server section conflict and prevents retry for deleted entities", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: "section_name_conflict",
          message: "Conflict",
          status: 409,
        }),
      )
      .mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: null,
          message: "Missing",
          status: 404,
        }),
      );
    render(<RenameRow kind="section" onSave={onSave} />);
    fireEvent.keyDown(await start(), { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "A section with this name already exists.",
      ),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Another name" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "This item no longer exists.",
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Retry saving name" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves on departure without stealing focus after the response", async () => {
    const pending = deferred();
    const onSave = vi.fn().mockReturnValue(pending.promise);
    render(
      <>
        <RenameRow onSave={onSave} />
        <button>Elsewhere</button>
      </>,
    );
    await start();
    const destination = screen.getByRole("button", { name: "Elsewhere" });
    await act(async () => new Promise(requestAnimationFrame));
    act(() => destination.focus());
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    await act(async () => pending.resolve());
    expect(document.activeElement).toBe(destination);
  });

  it("preserves a draft through external updates and displays the latest name after cancel", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<RenameRow onSave={onSave} />);
    await start("My draft");
    rerender(<RenameRow name="Changed elsewhere" onSave={onSave} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "My draft",
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByText("Changed elsewhere")).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps an invalid active draft when another row asks to rename, then saves before switching", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SidebarRenameProvider>
        <RenameRow onSave={onSave} />
        <RenameRow id="second" onSave={onSave} />
        <SessionState />
      </SidebarRenameProvider>,
    );
    const input = await start(" ");
    fireEvent.click(screen.getByRole("button", { name: "Rename second" }));
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.queryByRole("textbox", { name: "second name" })).toBeNull();
    fireEvent.change(input, { target: { value: "Finish first" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename second" }));
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "second name" }),
      ).not.toBeNull(),
    );
    expect(onSave).toHaveBeenCalledExactlyOnceWith("Finish first");
    expect(screen.getByLabelText("Active rename").textContent).toBe("second");
  });

  it("preserves the provider draft when its owning row unmounts and remounts", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SidebarRenameProvider>
        <RenameRow onSave={onSave} />
      </SidebarRenameProvider>,
    );
    await start("Keep my draft");
    rerender(<SidebarRenameProvider>{null}</SidebarRenameProvider>);
    rerender(
      <SidebarRenameProvider>
        <RenameRow onSave={onSave} />
      </SidebarRenameProvider>,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Keep my draft",
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears environment names only through the explicit clear action", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClear = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow kind="environment" onSave={onSave} onClear={onClear} />);
    fireEvent.keyDown(await start(" "), { key: "Enter" });
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear custom name" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
