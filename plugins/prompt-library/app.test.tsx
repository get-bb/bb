// @vitest-environment jsdom

import type { z } from "zod";

import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginComposerScope } from "@get-bb/plugin-sdk/app";
import type {
  promptLibraryRpcContract,
  RecentPromptRow,
  StarredPromptRow,
  searchPromptsInputSchema,
} from "./contract.js";

let pickerWidth = 728;
const originalScroll = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

class TestResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    this.callback();
  }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: pickerWidth,
      bottom: 320,
      width: pickerWidth,
      height: 320,
      toJSON: () => ({}),
    }),
  );
});

const app = await loadPluginApp(() => import("./app"));
const popup = app.composerCustomizations[0]!.experimental_popups![0]!;

function draft(value: string) {
  return { text: value, mentions: [] };
}

function starredRow(id: string, value: string): StarredPromptRow {
  return {
    kind: "starred",
    title: null,
    titleSnippet: null,
    id,
    prompt: draft(value),
    snippet: { text: value, highlights: [] },
    createdAt: 1,
    lastUsedAt: null,
  };
}

function recentRow(
  id: string,
  value: string,
  starredId: string | null = null,
): RecentPromptRow {
  return {
    kind: "recent",
    id,
    prompt: draft(value),
    snippet: { text: value, highlights: [] },
    createdAt: 1,
    projectId: "proj_a",
    projectName: "Alpha",
    threadId: "thr_1",
    starredId,
  };
}

function render(
  options: {
    scope?: PluginComposerScope;
    draft?: string;
    starred?: StarredPromptRow[];
    recent?: RecentPromptRow[];
  } = {},
) {
  const search = vi.fn(
    async (
      _input: z.input<typeof searchPromptsInputSchema>,
    ): Promise<z.output<typeof promptLibraryRpcContract.search.output>> => ({
      loading: false,
      historyError: null,
      prompts: [
        ...(options.starred ?? [starredRow("prompt_1", "starred prompt")]),
        ...(options.recent ?? [recentRow("h1", "recent prompt")]),
      ],
    }),
  );
  const star = vi.fn(() => ({ id: "prompt_new" }));
  const unstar = vi.fn(() => ({ unstarred: true }));
  const setTitle = vi.fn(
    ({ id, title }: { id: string; title: string | null }) => ({ id, title }),
  );
  const markUsed = vi.fn(() => null);
  const slot = renderSlot<object, typeof promptLibraryRpcContract>(
    popup,
    {},
    {
      pluginId: "prompt-library",
      context: { projectId: "proj_a", threadId: "thr_1" },
      composer: {
        scope: options.scope ?? { kind: "thread", threadId: "thr_1" },
        text: options.draft ?? "",
      },
      rpc: { search, star, unstar, markUsed, setTitle },
    },
  );
  return { slot, search, star, unstar, markUsed, setTitle };
}

function searchBox(slot: ReturnType<typeof renderSlot>) {
  return slot.getByRole("textbox", { name: "Search prompts" });
}

afterEach(() => {
  cleanup();
  if (originalScroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  pickerWidth = 728;
  window.localStorage.clear();
});

describe("prompt library popup", () => {
  it("shows saved prompts during indexing, updates automatically and stops polling when complete", async () => {
    vi.useFakeTimers();
    const { slot, search } = render();
    search.mockResolvedValueOnce({
      prompts: [starredRow("saved", "Saved review")],
      loading: true,
      historyError: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(slot.getByRole("option", { name: /Saved review/ })).toBeTruthy();
    expect(slot.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
    expect(slot.queryByRole("status")).toBeNull();
    search.mockResolvedValue({
      prompts: [recentRow("old", "Older review")],
      loading: false,
      historyError: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(slot.getByRole("option", { name: /Older review/ })).toBeTruthy();
    expect(slot.queryByRole("status")).toBeNull();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ refreshHistory: false }),
    );
    const calls = search.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(search).toHaveBeenCalledTimes(calls);
  });

  it("keeps saved prompts usable when history fails and retries explicitly", async () => {
    const { slot, search } = render();
    search.mockResolvedValueOnce({
      prompts: [starredRow("saved", "Saved review")],
      loading: false,
      historyError: "History offline",
    });
    await slot.findByRole("alert");
    expect(slot.getByRole("option", { name: /Saved review/ })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          refreshHistory: true,
          waitForHistory: false,
        }),
      ),
    );
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
  });

  it.each([728, 360])(
    "edits a title without inserting it at width %s",
    async (width) => {
      pickerWidth = width;
      const { slot, setTitle, search } = render();
      const option = await slot.findByRole("option", {
        name: /starred prompt/,
      });
      if (width === 360)
        fireEvent.click(within(option).getAllByRole("button")[0]!);
      fireEvent.click(await slot.findByRole("button", { name: "Add title" }));
      const input = slot.getByRole("textbox", { name: "Prompt title" });
      fireEvent.change(input, { target: { value: "Review" } });
      search.mockResolvedValue({
        loading: false,
        historyError: null,
        prompts: [
          {
            ...starredRow("prompt_1", "starred prompt"),
            title: "Review",
            titleSnippet: { text: "Review", highlights: [] },
          },
        ],
      });
      if (width === 728) fireEvent.keyDown(input, { key: "Enter" });
      else fireEvent.click(slot.getByRole("button", { name: "Save title" }));
      await slot.findByRole("button", { name: "Edit title" });
      expect(setTitle).toHaveBeenCalledWith({
        id: "prompt_1",
        title: "Review",
      });
      expect(slot.composer.draft.text).toBe("");
      fireEvent.click(slot.getByRole("button", { name: "Edit title" }));
      fireEvent.change(slot.getByRole("textbox", { name: "Prompt title" }), {
        target: { value: "Discard" },
      });
      fireEvent.keyDown(slot.getByRole("textbox", { name: "Prompt title" }), {
        key: "Escape",
      });
      expect(setTitle).toHaveBeenCalledTimes(1);
      fireEvent.click(slot.getByRole("button", { name: "Insert" }));
      expect(slot.composer.draft.text).toBe("starred prompt");
    },
  );

  it("retains a failed title edit for retry", async () => {
    const { slot, setTitle } = render();
    setTitle.mockImplementationOnce(() => {
      throw new Error("Unable to save");
    });
    fireEvent.click(await slot.findByRole("button", { name: "Add title" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Prompt title" }), {
      target: { value: "Review" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Save title" }));
    await slot.findByText("Unable to save");
    expect(
      slot.getByRole("textbox", { name: "Prompt title" }).getAttribute("value"),
    ).toBe("Review");
    fireEvent.click(slot.getByRole("button", { name: "Save title" }));
    await waitFor(() => expect(setTitle).toHaveBeenCalledTimes(2));
    expect(slot.composer.draft.text).toBe("");
  });

  it("inserts the highlighted prompt and records use of a starred one", async () => {
    const { slot, markUsed } = render();
    await slot.findByRole("option", { name: /starred prompt/ });

    fireEvent.keyDown(searchBox(slot), { key: "Enter" });

    expect(slot.composer.draft.text).toBe("starred prompt");
    await waitFor(() =>
      expect(markUsed).toHaveBeenCalledWith({ id: "prompt_1" }),
    );
  });

  it.each(["", "Existing draft: "])(
    "preserves cross-project mentions and restores history attachments only into an empty draft (%s)",
    async (existing) => {
      const row = recentRow("rich", "Review @project:proj_b");
      row.projectId = "proj_b";
      const mention = {
        from: 7,
        to: 22,
        kind: "project" as const,
        projectId: "proj_b",
        label: "Beta",
      };
      const attachment = {
        type: "localFile" as const,
        path: ".bb/attachments/notes.txt",
        name: "notes.txt",
        sizeBytes: 42,
      };
      row.prompt = {
        text: row.prompt.text,
        mentions: [mention],
        attachments: [attachment],
      };
      const { slot } = render({ draft: existing, starred: [], recent: [row] });
      const choice = await slot.findByRole("button", {
        name: /Review @project:proj_b/,
      });
      fireEvent.click(choice);
      fireEvent.click(slot.getByRole("button", { name: "Insert" }));
      expect(slot.composer.draft.text).toBe(
        `${existing}Review @project:proj_b`,
      );
      expect(slot.composer.draft.mentions).toEqual([
        { ...mention, from: 7 + existing.length, to: 22 + existing.length },
      ]);
      expect(slot.composer.draft.attachments).toEqual(
        existing === "" ? [attachment] : [],
      );
    },
  );

  it("moves through starred and recent rows with the arrow keys", async () => {
    const { slot, markUsed } = render();
    await slot.findByText("recent prompt");

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "Enter" });

    expect(slot.composer.draft.text).toBe("recent prompt");
    expect(markUsed).not.toHaveBeenCalled();
  });

  it("searches as you type and remembers the scope per composer kind", async () => {
    const first = render();
    await first.slot.findByRole("option", { name: /starred prompt/ });
    expect(first.search).toHaveBeenLastCalledWith({
      query: "",
      scope: "global",
      projectId: "proj_a",
      threadId: "thr_1",
      composer: "follow-up",
      waitForHistory: false,
      refreshHistory: true,
    });

    fireEvent.keyDown(searchBox(first.slot), { key: "Tab" });
    await waitFor(() =>
      expect(first.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: "thread" }),
      ),
    );
    fireEvent.change(searchBox(first.slot), { target: { value: "deploy" } });
    await waitFor(() =>
      expect(first.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "deploy", scope: "thread" }),
      ),
    );
    cleanup();

    const again = render();
    await again.slot.findByRole("option", { name: /starred prompt/ });
    expect(again.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "thread" }),
    );
    cleanup();

    const newThread = render({
      scope: { kind: "new-thread", projectId: "proj_a" },
    });
    await newThread.slot.findByRole("option", { name: /starred prompt/ });
    expect(newThread.search).toHaveBeenLastCalledWith({
      query: "",
      scope: "global",
      projectId: "proj_a",
      threadId: null,
      composer: "new-thread",
      waitForHistory: false,
      refreshHistory: true,
    });
    expect(
      within(newThread.slot.getByRole("radiogroup", { name: "Search scope" }))
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Project", "All"]);
  });

  it("recovers a stuck search in place and ignores its late response", async () => {
    vi.useFakeTimers();
    const { slot, search } = render();
    let resolveStale!: (value: Awaited<ReturnType<typeof search>>) => void;
    const stale = new Promise<Awaited<ReturnType<typeof search>>>((resolve) => {
      resolveStale = resolve;
    });
    search.mockImplementationOnce(() => stale);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(slot.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
    expect(slot.queryByLabelText("Searching prompts")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(slot.getByRole("alert").textContent).toContain("timed out");
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(slot.getByRole("option", { name: /recent prompt/ })).toBeTruthy();
    expect(slot.queryByRole("alert")).toBeNull();

    await act(async () =>
      resolveStale({
        loading: false,
        historyError: null,
        prompts: [recentRow("stale", "obsolete response")],
      }),
    );
    expect(slot.queryByText("obsolete response")).toBeNull();
    expect(slot.getByRole("option", { name: /recent prompt/ })).toBeTruthy();
  });

  it("keeps results in place while a search is pending and marks only a slow one", async () => {
    vi.useFakeTimers();
    const { slot, search } = render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const before = slot.getAllByRole("option").map((row) => row.textContent);
    search.mockImplementationOnce(() => new Promise(() => {}));

    fireEvent.change(searchBox(slot), { target: { value: "recent" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(slot.queryByRole("status")).toBeNull();
    expect(slot.queryByLabelText("Searching prompts")).toBeNull();
    expect(slot.getAllByRole("option").map((row) => row.textContent)).toEqual(
      before,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(slot.getByLabelText("Searching prompts")).toBeTruthy();
    expect(slot.getAllByRole("option").map((row) => row.textContent)).toEqual(
      before,
    );
  });

  it("retries a failed search without changing the query or losing loaded prompts", async () => {
    const { slot, search } = render();
    await slot.findByRole("option", { name: /recent prompt/ });
    search.mockRejectedValueOnce(new Error("Connection interrupted"));
    fireEvent.change(searchBox(slot), { target: { value: "recent" } });
    expect(await slot.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Connection interrupted"),
    );
    expect(slot.getByRole("option", { name: /recent prompt/ })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "recent", scope: "global" }),
    );
  });

  it("keeps saved stars visible when keyboard selection moves to another prompt", async () => {
    const { slot } = render({
      recent: [
        recentRow("h1", "saved history prompt", "prompt_2"),
        recentRow("h2", "ordinary history prompt"),
      ],
    });
    const saved = await slot.findByRole("option", { name: /starred prompt/ });
    const history = slot.getByRole("option", { name: /saved history prompt/ });
    const savedStar = within(saved).getByRole("button", { name: "Unstar" });
    const historyStar = within(history).getByRole("button", { name: "Unstar" });

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });

    expect(saved.getAttribute("aria-selected")).toBe("false");
    expect(history.getAttribute("aria-selected")).toBe("false");
    for (const button of [savedStar, historyStar]) {
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.classList.contains("opacity-0")).toBe(false);
    }
  });

  it("stars and unstars prompts with Mod+S", async () => {
    const { slot, star, unstar } = render({
      recent: [
        recentRow("h1", "recent prompt"),
        recentRow("h2", "already starred", "prompt_2"),
      ],
    });
    await slot.findByText("recent prompt");

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "s", metaKey: true });
    await waitFor(() =>
      expect(star).toHaveBeenCalledWith({ prompt: draft("recent prompt") }),
    );

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.keyDown(searchBox(slot), { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(unstar).toHaveBeenCalledWith({ id: "prompt_2" }),
    );
  });

  it("offers to star a non-empty draft that is not starred yet", async () => {
    const { slot, star } = render({ draft: "draft to keep" });
    await slot.findByText("Star current draft");

    fireEvent.keyDown(searchBox(slot), { key: "Enter" });

    await waitFor(() =>
      expect(star).toHaveBeenCalledWith({ prompt: draft("draft to keep") }),
    );
    expect(slot.composer.draft.text).toBe("draft to keep");
  });

  it("inserts into a non-empty draft instead of replacing it", async () => {
    const { slot } = render({ draft: "Before merging, " });
    await slot.findByText("recent prompt");

    fireEvent.click(slot.getByText("recent prompt"));
    expect(slot.composer.draft.text).toBe("Before merging, ");
    fireEvent.click(slot.getByRole("button", { name: "Insert" }));

    expect(slot.composer.draft.text).toBe("Before merging, recent prompt");
  });

  it("previews the highlighted prompt in full beside the list", async () => {
    const long = `${"Please start a worktree server. ".repeat(20)}\n\nThen share the link.`;
    const { slot } = render({ recent: [recentRow("h1", long)] });
    await slot.findByRole("option", { name: /starred prompt/ });
    const preview = slot.getByRole("region", { name: "Prompt preview" });
    expect(preview.textContent).toContain("starred prompt");

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });

    await waitFor(() =>
      expect(
        slot.getByRole("region", { name: "Prompt preview" }).textContent,
      ).toContain("Then share the link."),
    );
    fireEvent.click(
      within(slot.getByRole("region", { name: "Prompt preview" })).getByRole(
        "button",
        { name: "Insert" },
      ),
    );
    expect(slot.composer.draft.text).toBe(long);
  });

  it("keeps the preview selected while moving the mouse to its star action", async () => {
    const { slot, star } = render({
      recent: [
        recentRow("h1", "recent prompt"),
        recentRow("h2", "other prompt"),
      ],
    });
    await slot.findByText("recent prompt");
    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    fireEvent.mouseEnter(slot.getByRole("option", { name: /other prompt/ }));
    fireEvent.mouseMove(slot.getByRole("option", { name: /other prompt/ }));

    const preview = slot.getByRole("region", { name: "Prompt preview" });
    expect(preview.textContent).toContain("recent prompt");
    fireEvent.click(within(preview).getByRole("button", { name: "Star" }));
    await waitFor(() =>
      expect(star).toHaveBeenCalledWith({ prompt: draft("recent prompt") }),
    );
  });

  it("keeps the same recent prompt selected when starring changes row positions", async () => {
    const { slot, search } = render();
    await slot.findByText("recent prompt");
    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    search.mockResolvedValue({
      loading: false,
      historyError: null,
      prompts: [
        starredRow("prompt_new", "recent prompt"),
        starredRow("prompt_1", "starred prompt"),
        recentRow("h1", "recent prompt", "prompt_new"),
      ],
    });
    fireEvent.click(
      within(slot.getByRole("region", { name: "Prompt preview" })).getByRole(
        "button",
        { name: "Star" },
      ),
    );
    await waitFor(() => expect(slot.getAllByRole("option")).toHaveLength(3));
    expect(slot.getByRole("option", { selected: true }).textContent).toContain(
      "recent prompt",
    );
    const preview = slot.getByRole("region", { name: "Prompt preview" });
    expect(preview.textContent).toContain("recent prompt");
    expect(
      within(preview)
        .getByRole("button", { name: "Starred" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("shows a search as one ranked list and keeps a prompt selected when it is unstarred", async () => {
    const { slot, search, unstar } = render();
    const listbox = await slot.findByRole("listbox", { name: "Prompts" });
    expect(await within(listbox).findByText("Recent")).toBeTruthy();
    search.mockResolvedValue({
      loading: false,
      historyError: null,
      prompts: [
        recentRow("h2", "deploy later"),
        starredRow("prompt_1", "please deploy the docs"),
      ],
    });
    fireEvent.change(searchBox(slot), { target: { value: "deploy" } });
    await within(listbox).findByText("deploy later");
    expect(within(listbox).queryByText("Starred")).toBeNull();
    expect(within(listbox).queryByText("Recent")).toBeNull();

    fireEvent.keyDown(searchBox(slot), { key: "ArrowDown" });
    search.mockResolvedValue({
      loading: false,
      historyError: null,
      prompts: [
        recentRow("h2", "deploy later"),
        recentRow("h4", "please deploy the docs"),
      ],
    });
    fireEvent.keyDown(searchBox(slot), { key: "s", metaKey: true });
    await waitFor(() =>
      expect(unstar).toHaveBeenCalledWith({ id: "prompt_1" }),
    );
    await waitFor(() =>
      expect(
        within(slot.getByRole("region", { name: "Prompt preview" }))
          .getByRole("button", { name: "Star" })
          .getAttribute("aria-pressed"),
      ).toBe("false"),
    );
    expect(slot.getByRole("option", { selected: true }).textContent).toContain(
      "please deploy the docs",
    );
  });

  it("opens a preview on tap when there is no room for two panes", async () => {
    pickerWidth = 390;
    const { slot } = render();
    await slot.findByText("recent prompt");
    expect(slot.queryByRole("region", { name: "Prompt preview" })).toBeNull();

    fireEvent.click(slot.getByText("recent prompt"));

    const preview = await slot.findByRole("region", { name: "Prompt preview" });
    expect(slot.queryByRole("listbox", { name: "Prompts" })).toBeNull();
    expect(slot.composer.draft.text).toBe("");

    fireEvent.click(within(preview).getByRole("button", { name: "Back" }));
    expect(await slot.findByRole("listbox", { name: "Prompts" })).toBeTruthy();

    fireEvent.click(slot.getByText("recent prompt"));
    fireEvent.click(
      within(
        await slot.findByRole("region", { name: "Prompt preview" }),
      ).getByRole("button", { name: "Insert" }),
    );
    expect(slot.composer.draft.text).toBe("recent prompt");
  });
});
