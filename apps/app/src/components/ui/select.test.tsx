// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

const pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

beforeEach(() => {
  pendingFrames.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrameId += 1;
    pendingFrames.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pendingFrames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function runNextFrame() {
  act(() => {
    const queued = Array.from(pendingFrames.entries());
    pendingFrames.clear();
    for (const [, callback] of queued) callback(performance.now());
  });
}

function runFrames() {
  for (let i = 0; i < 4; i += 1) runNextFrame();
}

function topmostOpenBackdrop(): HTMLElement {
  const backdrops = document.querySelectorAll<HTMLElement>(
    '[data-persistent-drawer-backdrop][data-state="open"]',
  );
  const top = backdrops[backdrops.length - 1];
  if (top === undefined) throw new Error("no open drawer backdrop");
  return top;
}

function FolderOptions() {
  return (
    <SelectContent>
      <SelectItem value="none">No folder</SelectItem>
      <SelectGroup>
        <SelectLabel>Folders</SelectLabel>
        <SelectItem value="work">Work</SelectItem>
        <SelectItem value="archive" disabled>
          Archive
        </SelectItem>
        <SelectItem value="personal" textValue="Home">
          Personal
        </SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectItem value="new">New folder…</SelectItem>
    </SelectContent>
  );
}

function NewProjectDialog({ compact }: { compact: boolean }) {
  const [open, setOpen] = useState(true);
  const [folder, setFolder] = useState("none");
  return (
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <main data-testid="app-root">
        <output aria-label="Dialog state">{open ? "open" : "closed"}</output>
      </main>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>New project</DialogTitle>
          <input aria-label="Project name" />
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger aria-label="Folder">
              <SelectValue />
            </SelectTrigger>
            <FolderOptions />
          </Select>
        </DialogContent>
      </Dialog>
    </CompactViewportOverrideProvider>
  );
}

function renderCompactDialog() {
  render(<NewProjectDialog compact />);
  runFrames();
  const name = screen.getByRole("textbox", { name: "Project name" });
  fireEvent.change(name, { target: { value: "Roadmap" } });
  return {
    name,
    trigger: screen.getByRole("combobox", { name: "Folder" }),
    dialogState: () => screen.getByLabelText("Dialog state").textContent,
  };
}

function openPicker(trigger: HTMLElement) {
  fireEvent.click(trigger);
  runFrames();
  return screen.getByRole("listbox");
}

describe("compact Select nested in a compact Dialog", () => {
  it("dismisses only the picker from the surface over its trigger and from Escape", () => {
    const { name, trigger, dialogState } = renderCompactDialog();

    openPicker(trigger);
    expect(screen.getByRole("dialog", { name: "Folder" })).toBeTruthy();
    fireEvent.click(topmostOpenBackdrop());

    expect(dialogState()).toBe("open");
    expect(screen.queryByRole("listbox")).toBeNull();
    runFrames();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe("Roadmap");

    openPicker(trigger);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(dialogState()).toBe("open");

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(dialogState()).toBe("closed");
  });

  it("selects an enabled option, keeps the parent and returns focus to the trigger", () => {
    const { name, trigger, dialogState } = renderCompactDialog();

    const listbox = openPicker(trigger);
    expect(
      within(listbox).getByRole("group", { name: "Folders" }),
    ).toBeTruthy();
    const archive = within(listbox).getByRole("option", { name: "Archive" });
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(archive);
    expect(screen.getByRole("listbox")).toBe(listbox);

    fireEvent.click(within(listbox).getByRole("option", { name: "Personal" }));
    runFrames();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toBe("Personal");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(dialogState()).toBe("open");
    expect((name as HTMLInputElement).value).toBe("Roadmap");

    const reopened = openPicker(trigger);
    expect(
      within(reopened)
        .getByRole("option", { name: "Personal" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("opens from the keyboard, skips disabled options and selects with Enter", () => {
    const { trigger, dialogState } = renderCompactDialog();

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    runFrames();
    const listbox = screen.getByRole("listbox", { name: "Folder" });
    expect(document.activeElement).toBe(
      within(listbox).getByRole("option", { name: "No folder" }),
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
    });
    expect(document.activeElement).toBe(
      within(listbox).getByRole("option", { name: "Personal" }),
    );
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowUp",
    });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    runFrames();

    expect(trigger.textContent).toBe("Personal");
    expect(document.activeElement).toBe(trigger);
    expect(dialogState()).toBe("open");
  });

  it("moves focus by typeahead, honouring textValue and skipping disabled options", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { trigger } = renderCompactDialog();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    runFrames();
    const listbox = screen.getByRole("listbox", { name: "Folder" });
    const option = (name: string) =>
      within(listbox).getByRole("option", { name });
    const type = (key: string) =>
      fireEvent.keyDown(document.activeElement as HTMLElement, { key });

    type("w");
    type("o");
    expect(document.activeElement).toBe(option("Work"));
    act(() => vi.advanceTimersByTime(1000));
    type("h");
    expect(document.activeElement).toBe(option("Personal"));
    act(() => vi.advanceTimersByTime(1000));
    type("a");
    expect(document.activeElement).toBe(option("Personal"));
    act(() => vi.advanceTimersByTime(1000));
    type("n");
    expect(document.activeElement).toBe(option("New folder…"));
    type("n");
    expect(document.activeElement).toBe(option("No folder"));
    type(" ");
    expect(screen.getByRole("listbox", { name: "Folder" })).toBe(listbox);
    expect(trigger.textContent).toBe("No folder");

    act(() => vi.advanceTimersByTime(1000));
    type("h");
    type("Enter");
    runFrames();
    expect(trigger.textContent).toBe("Personal");
  });

  it("leaves the app tree exposed and realizes options two frames after opening", () => {
    const { trigger } = renderCompactDialog();
    const appRoot = screen.getByTestId("app-root");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("option", { name: "Work" })).toBeNull();
    runNextFrame();
    expect(screen.queryByRole("option", { name: "Work" })).toBeNull();
    runNextFrame();
    const work = screen.getByRole("option", { name: "Work" });

    for (const element of [appRoot, appRoot.parentElement as HTMLElement]) {
      expect(element.getAttribute("aria-hidden")).toBeNull();
      expect(element.hasAttribute("inert")).toBe(false);
    }

    fireEvent.click(topmostOpenBackdrop());
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Work" })).toBe(work);
  });
});

describe("Select value ownership", () => {
  it("tracks an uncontrolled value in compact mode and reports only changes", () => {
    const onValueChange = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <Select defaultValue="work" onValueChange={onValueChange}>
          <SelectTrigger aria-label="Folder">
            <SelectValue placeholder="Choose folder" />
          </SelectTrigger>
          <FolderOptions />
        </Select>
      </CompactViewportOverrideProvider>,
    );
    const trigger = screen.getByRole("combobox", { name: "Folder" });
    expect(trigger.textContent).toBe("Work");

    fireEvent.click(
      within(openPicker(trigger)).getByRole("option", { name: "Work" }),
    );
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.click(
      within(openPicker(trigger)).getByRole("option", { name: "New folder…" }),
    );
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("new");
    expect(trigger.textContent).toBe("New folder…");
  });

  it("keeps the floating listbox on desktop", () => {
    render(<NewProjectDialog compact={false} />);
    const trigger = screen.getByRole("combobox", { name: "Folder" });

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const listbox = screen.getByRole("listbox");
    expect(
      document.querySelector("[data-persistent-drawer-content]"),
    ).toBeNull();

    fireEvent.click(within(listbox).getByRole("option", { name: "Work" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toBe("Work");
  });
});
