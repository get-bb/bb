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
import {
  SidebarRenameProvider,
  useSidebarRename,
} from "./SidebarInlineRename.js";
import { renameError } from "./SidebarRenameEditor.js";

afterEach(cleanup);

class FakeHttpError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, code: string | null) {
    super(`HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

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

describe("renameError", () => {
  it("duck-types status and code from any error-like object", () => {
    expect(
      renameError({ status: 409, code: "section_name_conflict" }, "thread"),
    ).toEqual({
      error: "A section with this name already exists.",
      cannotRetry: false,
    });
    expect(renameError({ status: 409, code: null }, "section")).toEqual({
      error: "A section with this name already exists.",
      cannotRetry: false,
    });
    expect(renameError({ status: 409, code: null }, "thread")).toEqual({
      error: "Could not save the name. Try again.",
      cannotRetry: false,
    });
    expect(renameError({ status: 410 }, "thread")).toEqual({
      error: "This item no longer exists.",
      cannotRetry: true,
    });
    expect(renameError({ status: 403 }, "thread")).toEqual({
      error: "You do not have permission to rename this item.",
      cannotRetry: true,
    });
    expect(renameError(new Error("offline"), "thread")).toEqual({
      error: "Could not save the name. Try again.",
      cannotRetry: false,
    });
    expect(renameError({ status: "404" }, "thread")).toEqual({
      error: "Could not save the name. Try again.",
      cannotRetry: false,
    });
    expect(renameError(null, "thread")).toEqual({
      error: "Could not save the name. Try again.",
      cannotRetry: false,
    });
  });
});

describe("sidebar inline rename", () => {
  it("selects the current name and restores row focus after Escape without saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename first" }));
    const input = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "first name",
    });
    await waitFor(() => expect(document.activeElement).toBe(input));
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

  it("does not submit composition Enter or blur within the editor", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClear = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow kind="environment" onSave={onSave} onClear={onClear} />);
    const input = await start();
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.compositionEnd(input);
    fireEvent.blur(input, {
      relatedTarget: screen.getByRole("button", { name: "Clear custom name" }),
    });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
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
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onSave.mock.calls).toEqual([["New name"], ["New name"]]);
  });

  it("uses the server section conflict and prevents retry for deleted entities", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new FakeHttpError(409, "section_name_conflict"))
      .mockRejectedValueOnce(new FakeHttpError(404, null));
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
    expect(screen.getByRole("textbox").hasAttribute("readonly")).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
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

  it("keeps an invalid active draft when another row asks to rename, then saves before switching", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SidebarRenameProvider>
        <RenameRow onSave={onSave} />
        <RenameRow id="second" onSave={onSave} />
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
  });

  it("retains a draft through external updates and row remounts, then cancels to the current name", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const row = (name = "Original name") => (
      <SidebarRenameProvider>
        <RenameRow name={name} onSave={onSave} />
      </SidebarRenameProvider>
    );
    const { rerender } = render(row());
    await start("Keep my draft");
    rerender(row("Changed elsewhere"));
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      "Keep my draft",
    );
    rerender(<SidebarRenameProvider>{null}</SidebarRenameProvider>);
    rerender(row("Changed elsewhere"));
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      "Keep my draft",
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.getByText("Changed elsewhere")).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears environment names when the submitted value is empty", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClear = vi.fn().mockResolvedValue(undefined);
    render(<RenameRow kind="environment" onSave={onSave} onClear={onClear} />);
    fireEvent.keyDown(await start(" "), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
