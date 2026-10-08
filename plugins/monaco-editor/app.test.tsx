// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";

const editor = vi.hoisted(() => ({
  setSelection: vi.fn(),
  revealRangeInCenter: vi.fn(),
  focus: vi.fn(),
  getModel: vi.fn(() => ({
    getLineCount: () => 160,
    getLineMaxColumn: () => 42,
    dispose: vi.fn(),
  })),
  onDidFocusEditorWidget: vi.fn(),
  onDidChangeModelContent: vi.fn<(listener: () => void) => void>(),
  getValue: vi.fn(() => "Edited on a phone"),
  setValue: vi.fn<(content: string) => void>(),
  addCommand: vi.fn<(keybinding: number, handler: () => void) => void>(),
  updateOptions: vi.fn(),
  dispose: vi.fn(),
}));
const create = vi.hoisted(() => vi.fn(() => editor));
vi.mock("./lib/monaco-loader.js", () => ({
  loadMonaco: async () => ({
    editor: { create },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 },
  }),
  overflowWidgetsNode: () => document.body,
  setOverflowWidgetsTheme: vi.fn(),
}));
vi.mock("./lib/monaco-theme.js", () => ({
  applyCodeTheme: () => ({ name: "test", base: "vs-dark" }),
  editorBackground: () => "black",
}));

const app = await loadPluginApp(() => import("./app"));
const registration = app.fileOpeners[0]!;
const Component = registration.component;
const base: PluginFileOpenerProps = {
  path: "target.ts",
  source: {
    kind: "workspace",
    environmentId: "env_1",
    projectId: null,
    threadId: null,
  },
  Original: () => <div>native</div>,
};
const file = {
  kind: "text",
  content: "fixture",
  sha256: "hash",
  absolutePath: "/fixture/target.ts",
  relativePath: "target.ts",
};
function mount(
  range: PluginFileOpenerProps["experimental_lineRange"],
  read: () => unknown = () => file,
) {
  return renderSlot(
    registration,
    { ...base, experimental_lineRange: range },
    {
      rpc: { assets: () => ({ baseUrl: "/assets", expiresAtMs: 99999 }), read },
    },
  );
}
const range = (startLineNumber: number, endLineNumber = startLineNumber) => ({
  startLineNumber,
  endLineNumber,
});

beforeEach(() => {
  vi.clearAllMocks();
  editor.getValue.mockReturnValue("Edited on a phone");
  editor.setValue.mockImplementation((content) => {
    editor.getValue.mockReturnValue(content);
    editor.onDidChangeModelContent.mock.calls.at(-1)?.[0]();
  });
});
afterEach(cleanup);

it("saves edits with the toolbar button and prevents duplicate pending saves", async () => {
  let finishSave = (_value: { outcome: "written"; sha256: string }) => {};
  const write = vi.fn(
    () =>
      new Promise<{ outcome: "written"; sha256: string }>((resolve) => {
        finishSave = resolve;
      }),
  );
  renderSlot(registration, base, {
    rpc: {
      assets: () => ({ baseUrl: "/assets", expiresAtMs: 99999 }),
      read: () => file,
      write,
    },
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  act(() => editor.onDidChangeModelContent.mock.calls[0]![0]());
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(write).toHaveBeenCalledWith({
    path: base.path,
    source: base.source,
    content: "Edited on a phone",
    expectedSha256: file.sha256,
  });
  const pendingButton = screen.getByRole("button", { name: "Saving…" });
  expect(pendingButton.hasAttribute("disabled")).toBe(true);
  fireEvent.click(pendingButton);
  expect(write).toHaveBeenCalledOnce();
  await act(async () => finishSave({ outcome: "written", sha256: "saved" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
  ).toBe(false);
});

it("overwrites the conflicted version and requires confirmation for a newer conflict", async () => {
  const write = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "conflict", currentSha256: "external" })
    .mockResolvedValueOnce({ outcome: "conflict", currentSha256: "newer" })
    .mockResolvedValue({ outcome: "written", sha256: "saved" });
  renderSlot(registration, base, {
    rpc: {
      assets: () => ({ baseUrl: "/assets", expiresAtMs: 99999 }),
      read: () => file,
      write,
    },
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Save my edits" });
  const saveButton = screen.getByRole("button", { name: "Save" });
  expect(saveButton.getAttribute("aria-disabled")).toBe("true");
  expect(saveButton.getAttribute("aria-description")).toBe(
    "Resolve the file conflict below",
  );
  fireEvent.click(saveButton);
  act(() => editor.addCommand.mock.calls[0]![1]());
  expect(write).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(
    screen.getByRole("status", {
      name: "File changed on disk, edits not saved.",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save my edits" }));
  await screen.findByRole("button", { name: "Save my edits" });
  expect(write).toHaveBeenNthCalledWith(2, {
    path: base.path,
    source: base.source,
    content: "Edited on a phone",
    expectedSha256: "external",
  });
  fireEvent.click(screen.getByRole("button", { name: "Save my edits" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Save my edits" })).toBeNull(),
  );
  expect(write).toHaveBeenNthCalledWith(3, {
    path: base.path,
    source: base.source,
    content: "Edited on a phone",
    expectedSha256: "newer",
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(4));
  expect(write).toHaveBeenLastCalledWith({
    path: base.path,
    source: base.source,
    content: "Edited on a phone",
    expectedSha256: "saved",
  });
});

it("undoes keeping the disk version without writing and restores conflict protection", async () => {
  const diskFile = { ...file, content: "Updated on disk", sha256: "disk" };
  const read = vi.fn().mockReturnValueOnce(file).mockReturnValue(diskFile);
  const write = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "conflict", currentSha256: "external" })
    .mockResolvedValue({ outcome: "conflict", currentSha256: "newer" });
  renderSlot(registration, base, {
    rpc: {
      assets: () => ({ baseUrl: "/assets", expiresAtMs: 99999 }),
      read,
      write,
    },
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep disk version" }),
  );
  const undo = await screen.findByRole("button", { name: "Undo" });
  expect(editor.getValue()).toBe("Updated on disk");
  expect(document.activeElement).toBe(
    screen.getByRole("status", { name: "Disk version loaded." }),
  );
  fireEvent.click(undo);
  expect(editor.getValue()).toBe("Edited on a phone");
  expect(editor.focus).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(write).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Save my edits" }));
  await screen.findByRole("button", { name: "Save my edits" });
  expect(write).toHaveBeenLastCalledWith({
    path: base.path,
    source: base.source,
    content: "Edited on a phone",
    expectedSha256: "disk",
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep disk version" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  read.mockRejectedValueOnce(new Error("Disk unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Keep disk version" }));
  await screen.findByText("Disk unavailable");
  act(() => editor.addCommand.mock.calls[0]![1]());
  await screen.findByRole("button", { name: "Save my edits" });
  expect(write).toHaveBeenLastCalledWith({
    path: base.path,
    source: base.source,
    content: "Edited on a phone",
    expectedSha256: file.sha256,
  });
});

it.each(["edit", "file"])(
  "retires the discarded draft after a new %s",
  async (action) => {
    const slot = renderSlot(registration, base, {
      rpc: {
        assets: () => ({ baseUrl: "/assets", expiresAtMs: 99999 }),
        read: () => file,
        write: () => ({ outcome: "conflict", currentSha256: "external" }),
      },
    });
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep disk version" }),
    );
    await screen.findByRole("button", { name: "Undo" });
    if (action === "edit") {
      act(() => {
        editor.getValue.mockReturnValue("New edits to the disk version");
        editor.onDidChangeModelContent.mock.calls.at(-1)![0]();
      });
      expect(editor.getValue()).toBe("New edits to the disk version");
    } else {
      slot.lifecycle.rerender(<Component {...base} path="other.ts" />);
      await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    }
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  },
);

it("does not offer an old file's draft when its disk reload finishes after navigation", async () => {
  let finishRead = (_value: typeof file) => {};
  const pendingRead = new Promise<typeof file>((resolve) => {
    finishRead = resolve;
  });
  const read = vi
    .fn()
    .mockReturnValueOnce(file)
    .mockReturnValueOnce(pendingRead)
    .mockReturnValue(file);
  const nextEditor = { ...editor, setValue: vi.fn<(content: string) => void>() };
  create.mockReturnValueOnce(editor).mockReturnValueOnce(nextEditor);
  const slot = renderSlot(registration, base, {
    rpc: {
      assets: () => ({ baseUrl: "/assets", expiresAtMs: 99999 }),
      read,
      write: () => ({ outcome: "conflict", currentSha256: "external" }),
    },
  });
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep disk version" }),
  );
  slot.lifecycle.rerender(<Component {...base} path="other.ts" />);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  await act(async () => finishRead(file));
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(editor.setValue).not.toHaveBeenCalled();
  expect(nextEditor.setValue).not.toHaveBeenCalled();
});

it.each([range(80), range(120, 124)])(
  "selects and reveals the initial target %j after loading",
  async (target) => {
    mount(target);
    await waitFor(() =>
      expect(editor.setSelection).toHaveBeenCalledWith({
        ...target,
        startColumn: 1,
        endColumn: 42,
      }),
    );
    expect(editor.revealRangeInCenter).toHaveBeenCalledWith({
      ...target,
      startColumn: 1,
      endColumn: 42,
    });
  },
);

it.each([null, undefined])(
  "leaves an untargeted initial open alone (%s)",
  async (target) => {
    mount(target);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(editor.setSelection).not.toHaveBeenCalled();
  },
);

it("navigates changed and repeated targets without recreating the editor", async () => {
  const slot = mount(range(80));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  const target = range(120, 124);
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={target} />,
  );
  await waitFor(() =>
    expect(editor.setSelection).toHaveBeenLastCalledWith({
      ...target,
      startColumn: 1,
      endColumn: 42,
    }),
  );
  editor.setSelection.mockClear();
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={target} />,
  );
  expect(editor.setSelection).not.toHaveBeenCalled();
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={{ ...target }} />,
  );
  expect(editor.setSelection).toHaveBeenCalledOnce();
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={null} />,
  );
  expect(editor.setSelection).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(editor.dispose).not.toHaveBeenCalled();
});

it("uses only the latest target when several arrive before the file loads", async () => {
  let resolveRead = (_value: typeof file) => {};
  const pending = new Promise<typeof file>((resolve) => {
    resolveRead = resolve;
  });
  const slot = mount(range(30), () => pending);
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={range(90)} />,
  );
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={range(140)} />,
  );
  await act(async () => resolveRead(file));
  await waitFor(() => expect(editor.setSelection).toHaveBeenCalledOnce());
  expect(editor.setSelection).toHaveBeenLastCalledWith({
    ...range(140),
    startColumn: 1,
    endColumn: 42,
  });
  expect(create).toHaveBeenCalledOnce();
});

it("clamps a target beyond EOF to the final line", async () => {
  mount(range(200, 220));
  await waitFor(() =>
    expect(editor.setSelection).toHaveBeenCalledWith({
      ...range(160),
      startColumn: 1,
      endColumn: 42,
    }),
  );
});

it("does not create or navigate a disposed loading editor", async () => {
  let resolveRead = (_value: typeof file) => {};
  const pending = new Promise<typeof file>((resolve) => {
    resolveRead = resolve;
  });
  const slot = mount(range(80), () => pending);
  slot.lifecycle.unmount();
  await act(async () => resolveRead(file));
  expect(create).not.toHaveBeenCalled();
  expect(editor.setSelection).not.toHaveBeenCalled();
});

it("does not apply a stale target cleared during loading", async () => {
  let resolveRead = (_value: typeof file) => {};
  const pending = new Promise<typeof file>((resolve) => {
    resolveRead = resolve;
  });
  const slot = mount(range(80), () => pending);
  slot.lifecycle.rerender(
    <Component {...base} experimental_lineRange={null} />,
  );
  await act(async () => resolveRead(file));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(editor.setSelection).not.toHaveBeenCalled();
});
