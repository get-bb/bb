// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@/lib/prompt-draft";
import type {
  ProviderCommandSuggestion,
  PromptMentionSuggestion,
} from "@/components/promptbox/mentions/types";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { POINTER_COARSE_QUERY } from "@/components/ui/hooks/use-pointer-coarse";
import { restoreMatchMedia, setupMatchMedia } from "@/test/helpers/match-media";
import {
  PromptBoxInternal,
  type PromptBoxZenModeConfig,
  type TypeaheadCommandConfig,
} from "./PromptBoxInternal";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

interface PromptBoxHarnessProps {
  autoFocus?: boolean;
  historyEntries: PromptBoxHarnessDraft[];
  initialDraft: PromptBoxHarnessDraft;
  mentionSuggestions?: PromptMentionSuggestion[];
  command?: TypeaheadCommandConfig;
  onChangeSpy?: PromptBoxHarnessChangeSpy;
  onSubmitSpy?: PromptBoxSubmitSpy;
  onAttachFiles?: (files: File[]) => void | Promise<void>;
  placeholder?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  resetKey?: string | number;
  zenModeLayout?: PromptBoxZenModeConfig["layout"];
}

type PromptBoxHarnessDraft = Omit<PromptDraftState, "mentions"> & {
  mentions?: PromptDraftState["mentions"];
};

type PromptBoxHarnessChangeSpy = (
  nextText: string,
  nextMentions: PromptDraftState["mentions"],
) => void;

type PromptBoxSubmitSpy = () => void;

type HistoryArrowKey = "ArrowUp" | "ArrowDown";

interface PressHistoryArrowArgs {
  expectedValue: string;
  key: HistoryArrowKey;
  editor: HTMLElement;
}

interface PressIgnoredHistoryArrowArgs {
  expectedValue: string;
  key: HistoryArrowKey;
  editor: HTMLElement;
}

interface TestClipboardDataArgs {
  files?: File[];
  html?: string;
  text?: string;
}

interface TestClipboardItem {
  kind: "file";
  getAsFile: () => File | null;
}

interface TestClipboardData {
  items: TestClipboardItem[];
  getData: (format: string) => string;
}

function PromptBoxHarness(args: PromptBoxHarnessProps) {
  const [draft, setDraft] = useState<PromptDraftState>(
    normalizeHarnessDraft(args.initialDraft),
  );
  const historyEntries = args.historyEntries.map(normalizeHarnessDraft);

  return (
    <>
      <PromptBoxInternal
        value={draft.text}
        mentionRanges={draft.mentions}
        onChange={(nextText, nextMentions) => {
          args.onChangeSpy?.(nextText, nextMentions);
          setDraft((currentDraft) => ({
            ...currentDraft,
            text: nextText,
            mentions: nextMentions,
          }));
        }}
        onSubmit={args.onSubmitSpy ?? noopPromptSubmit}
        autoFocus={args.autoFocus ?? false}
        placeholder={args.placeholder}
        attachments={{
          items: draft.attachments,
          onAttachFiles: args.onAttachFiles,
          onRemove: () => {},
        }}
        typeahead={{
          mention: {
            suggestions: args.mentionSuggestions ?? [],
            isLoading: false,
            isError: false,
            onQueryChange: () => {},
            resolveLink: args.resolveMentionLink,
          },
          command: args.command ?? {
            trigger: null,
            suggestions: [],
            isLoading: false,
            isError: false,
            onQueryChange: () => {},
          },
        }}
        mentionMenuPlacement="bottom"
        zenMode={{
          layout: args.zenModeLayout,
          storageKey: null,
        }}
        history={{
          currentDraft: draft,
          entries: historyEntries,
          onSelectEntry: setDraft,
          resetKey: args.resetKey ?? "scope-1",
        }}
      />
      <output data-testid="draft-text">{draft.text}</output>
      <output data-testid="draft-mentions">{draft.mentions.length}</output>
      <output data-testid="draft-mentions-json">
        {JSON.stringify(draft.mentions)}
      </output>
    </>
  );
}

function noopPromptSubmit(): void {}

function normalizeHarnessDraft(draft: PromptBoxHarnessDraft): PromptDraftState {
  return {
    ...draft,
    mentions: draft.mentions ?? [],
  };
}

afterEach(() => {
  cleanup();
  restoreMatchMedia();
  vi.clearAllMocks();
});

async function pressHistoryArrow({
  expectedValue,
  editor,
  key,
}: PressHistoryArrowArgs): Promise<void> {
  const wasNotCanceled = fireEvent.keyDown(editor, { key });
  expect(wasNotCanceled).toBe(false);

  await waitFor(() => {
    expect(getDraftText()).toBe(expectedValue);
  });
}

function pressIgnoredHistoryArrow({
  expectedValue,
  editor,
  key,
}: PressIgnoredHistoryArrowArgs): void {
  const wasNotCanceled = fireEvent.keyDown(editor, {
    key,
  });
  expect(wasNotCanceled).toBe(true);
  expect(getDraftText()).toBe(expectedValue);
}

function getEditor(): HTMLElement {
  return screen.getByRole("textbox");
}

function getPromptEditorScrollContainer(container: HTMLElement): HTMLElement {
  const element = container.querySelector("[data-promptbox-editor-scroll]");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected prompt editor scroll container");
  }
  return element;
}

function getDraftText(): string {
  return screen.getByTestId("draft-text").textContent ?? "";
}

function getDraftMentionCount(): number {
  return Number(screen.getByTestId("draft-mentions").textContent ?? "0");
}

function getDraftMentionsJson(): string {
  return screen.getByTestId("draft-mentions-json").textContent ?? "";
}

function createTestClipboardData({
  files = [],
  html = "",
  text = "",
}: TestClipboardDataArgs): TestClipboardData {
  return {
    items: files.map((file) => ({
      kind: "file",
      getAsFile: () => file,
    })),
    getData: (format) => {
      if (format === "text/html") return html;
      if (format === "text/plain") return text;
      return "";
    },
  };
}

function pasteIntoEditor(
  editor: HTMLElement,
  args: TestClipboardDataArgs,
): boolean {
  return fireEvent.paste(editor, {
    clipboardData: createTestClipboardData(args),
  });
}

function findTextNodeAtOffset(
  root: Node,
  targetOffset: number,
): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let lastTextNode: Node | null = null;
  while (true) {
    const node = walker.nextNode();
    if (!node) break;
    lastTextNode = node;
    const textLength = node.textContent?.length ?? 0;
    if (targetOffset <= currentOffset + textLength) {
      return {
        node,
        offset: targetOffset - currentOffset,
      };
    }
    currentOffset += textLength;
  }

  return {
    node: lastTextNode ?? root,
    offset: lastTextNode?.textContent?.length ?? 0,
  };
}

function setEditorSelection(editor: HTMLElement, offset: number): void {
  editor.focus();
  const target = findTextNodeAtOffset(editor, offset);
  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);

  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Expected DOM selection");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe("PromptBoxInternal rich paste", () => {
  it("updates the empty editor placeholder after rerender", async () => {
    const { rerender } = render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
        placeholder="Loading thread options..."
      />,
    );

    await waitFor(() => {
      expect(getEditor().getAttribute("data-placeholder")).toBe(
        "Loading thread options...",
      );
    });

    rerender(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
        placeholder="Ask for follow up..."
      />,
    );

    await waitFor(() => {
      expect(getEditor().getAttribute("data-placeholder")).toBe(
        "Ask for follow up...",
      );
    });
    expect(
      getEditor()
        .querySelector(".is-editor-empty")
        ?.getAttribute("data-placeholder"),
    ).toBe("Ask for follow up...");
  });

  it("caps normal thread prompt scrolling at the thread zen-mode height", () => {
    const { container } = render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    expect(getPromptEditorScrollContainer(container).style.maxHeight).toBe(
      "50dvh",
    );
  });

  it("caps normal root compose prompt scrolling at the root zen-mode height", () => {
    const { container } = render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
        zenModeLayout="root-compose"
      />,
    );

    expect(getPromptEditorScrollContainer(container).style.maxHeight).toBe(
      "70dvh",
    );
  });

  it("reveals the caret inside the prompt editor scroll container after content changes", async () => {
    const { container } = render(
      <PromptBoxHarness
        initialDraft={{
          text: "First line",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );
    const scrollContainer = getPromptEditorScrollContainer(container);
    vi.spyOn(scrollContainer, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 320, 100),
    );
    const caretRect = new DOMRect(0, 140, 0, 18);
    const rangeRectSpy = vi
      .spyOn(Range.prototype, "getBoundingClientRect")
      .mockReturnValue(caretRect);

    try {
      const editor = getEditor();
      setEditorSelection(editor, getDraftText().length);
      const wasNotCanceled = pasteIntoEditor(editor, {
        text: "\nSecond line",
      });

      expect(wasNotCanceled).toBe(false);
      await waitFor(() => {
        expect(getDraftText()).toBe("First line\nSecond line");
      });
      await waitForAnimationFrame();

      expect(scrollContainer.scrollTop).toBe(70);
    } finally {
      rangeRectSpy.mockRestore();
    }
  });

  it("pastes multiline plain text as text and hard breaks", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      text: "First line\r\nSecond line\rThird line",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe("First line\nSecond line\nThird line");
    });
    expect(editor.querySelector("strong")).toBeNull();
    expect(editor.querySelector("a")).toBeNull();
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("li")).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("pastes rich HTML text/plain fallback as plain text and strips formatting and links", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: '<p>Intro</p><p><strong>Bold</strong> <a href="https://example.com">https://example.com</a></p><ul><li>First item</li><li>Second item</li></ul><p>Next</p>',
      text: "Intro\nBold https://example.com\nFirst item\nSecond item\nNext",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe(
        "Intro\nBold https://example.com\nFirst item\nSecond item\nNext",
      );
    });
    expect(editor.querySelector("strong")).toBeNull();
    expect(editor.querySelector("a")).toBeNull();
    expect(editor.querySelector("[href]")).toBeNull();
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("li")).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("normalizes html-only paragraphs, lists, and pre blocks to plain text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: "<p>Intro</p><ul><li>First item</li><li><strong>Second</strong> item</li></ul><pre><code>const x = 1;\nconsole.log(x);</code></pre>",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe(
        "Intro\n- First item\n- Second item\nconst x = 1;\nconsole.log(x);",
      );
    });
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("li")).toBeNull();
    expect(editor.querySelector("pre")).toBeNull();
    expect(editor.querySelector("code")).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("pastes copied mention pills with clipboard metadata as mention nodes", async () => {
    const resource = {
      kind: "thread",
      threadId: "thr_design",
      projectId: "proj_design",
      label: "Design review",
    };
    const serializedText = "@thread:thr_design";
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: `<p>Ask <span data-prompt-mention="true" data-prompt-mention-serialized-text="${serializedText}" data-prompt-mention-resource='${JSON.stringify(
        resource,
      )}'>Thread: Design review</span> next</p>`,
      text: `Ask ${serializedText} next`,
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe(`Ask ${serializedText} next`);
    });
    const expectedMention = {
      start: "Ask ".length,
      end: `Ask ${serializedText}`.length,
      resource,
    };
    expect(getDraftMentionsJson()).toBe(JSON.stringify([expectedMention]));
    expect(getDraftMentionCount()).toBe(1);
    expect(editor.querySelector('[data-prompt-mention="true"]')).not.toBeNull();
  });

  it("derives pasted mention text from resource metadata instead of forged serialized text", async () => {
    const resource = {
      kind: "thread",
      threadId: "thr_design",
      projectId: "proj_design",
      label: "Design review",
    };
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: `<p>Ask <span data-prompt-mention="true" data-prompt-mention-serialized-text="@thread:thr_forged" data-prompt-mention-resource='${JSON.stringify(
        resource,
      )}'>Thread: Forged review</span> next</p>`,
      text: "Ask @thread:thr_forged next",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe("Ask @thread:thr_design next");
    });
    const expectedMention = {
      start: "Ask ".length,
      end: "Ask @thread:thr_design".length,
      resource,
    };
    expect(getDraftMentionsJson()).toBe(JSON.stringify([expectedMention]));
    expect(getDraftMentionCount()).toBe(1);
  });

  it("pastes copied mention pills without clipboard metadata as plain serialized text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: '<span data-prompt-mention="true" title="Thread: Design review">Thread: Design review</span>',
      text: "@thread:thr_design",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe("@thread:thr_design");
    });
    expect(getDraftMentionCount()).toBe(0);
    expect(editor.querySelector('[data-prompt-mention="true"]')).toBeNull();
  });

  it("keeps file paste handling on the attachment path", async () => {
    const onAttachFiles = vi.fn();
    const file = new File(["image"], "screenshot.png", {
      type: "image/png",
    });
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
        onAttachFiles={onAttachFiles}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      files: [file],
      html: "<p>Ignored rich text</p>",
      text: "Ignored rich text",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(onAttachFiles).toHaveBeenCalledTimes(1);
    });
    expect(onAttachFiles).toHaveBeenCalledWith([file]);
    expect(getDraftText()).toBe("");
  });
});

describe("PromptBoxInternal submit shortcuts", () => {
  it("submits on unshifted Enter for fine pointer devices", () => {
    const onSubmit = vi.fn();
    render(
      <PromptBoxHarness
        initialDraft={{ text: "Run this", attachments: [] }}
        historyEntries={[]}
        onSubmitSpy={onSubmit}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    const wasNotCanceled = fireEvent.keyDown(editor, { key: "Enter" });

    expect(wasNotCanceled).toBe(false);
    expect(editor.getAttribute("enterkeyhint")).toBe("send");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on unshifted Enter for coarse pointer devices", async () => {
    setupMatchMedia({
      matchesByQuery: new Map([[POINTER_COARSE_QUERY, true]]),
    });
    const onSubmit = vi.fn();
    render(
      <PromptBoxHarness
        initialDraft={{ text: "First line", attachments: [] }}
        historyEntries={[]}
        onSubmitSpy={onSubmit}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor.getAttribute("enterkeyhint")).toBe("enter");
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(getDraftText()).toBe("First line\n");
    });
  });
});

describe("PromptBoxInternal mentions", () => {
  it("shows the full path as the hover title for file mention pills", async () => {
    const text = "Open @apps/app/src/App.tsx";
    const token = "@apps/app/src/App.tsx";
    const start = text.indexOf(token);
    render(
      <PromptBoxHarness
        initialDraft={{
          text,
          mentions: [
            {
              start,
              end: start + token.length,
              resource: {
                kind: "path",
                source: "workspace",
                entryKind: "file",
                path: "apps/app/src/App.tsx",
                label: "App.tsx",
              },
            },
          ],
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("textbox")
          .querySelector('[data-prompt-mention="true"]')
          ?.getAttribute("title"),
      ).toBe("apps/app/src/App.tsx");
    });
  });

  it("opens an inserted mention pill via its resolved link on click", async () => {
    const openThread = vi.fn();
    const resolveMentionLink: PromptMentionLinkResolver = (resource) =>
      resource.kind === "thread" ? () => openThread(resource.threadId) : null;
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Ask @thread:thr_x to review",
          mentions: [
            {
              start: 4,
              end: 17,
              resource: {
                kind: "thread",
                threadId: "thr_x",
                label: "Design review",
              },
            },
          ],
          attachments: [],
        }}
        historyEntries={[]}
        resolveMentionLink={resolveMentionLink}
      />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("textbox")
          .querySelector('[data-prompt-mention="true"]'),
      ).not.toBeNull();
    });
    const pill = screen
      .getByRole("textbox")
      .querySelector('[data-prompt-mention="true"]');
    if (!pill) {
      throw new Error("Expected a mention pill in the editor");
    }
    expect(
      screen.getByRole("button", {
        name: "Open Thread: Design review",
      }),
    ).toBe(pill);
    fireEvent.click(pill);
    fireEvent.keyDown(pill, { key: "Enter" });
    fireEvent.keyDown(pill, { key: " " });

    expect(openThread).toHaveBeenCalledTimes(3);
    expect(openThread).toHaveBeenCalledWith("thr_x");
  });

  it("hides mention results after applying a mention before existing text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Please check @readme-file and update tests",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "a.md",
            name: "a.md",
            replacement: "a.md",
          },
        ]}
      />,
    );

    const editor = getEditor();
    const mentionEnd = "Please check @readme-file".length;
    setEditorSelection(editor, mentionEnd);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /a\.md/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Please check @a.md and update tests");
    });

    fireEvent.click(editor);

    expect(screen.queryByRole("button", { name: /a\.md/ })).toBeNull();
  });

  it("keeps a mention query dismissed after Escape while the caret stays in range", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Please check @pro",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "src/project.ts",
            name: "project.ts",
            replacement: "src/project.ts",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(
      await screen.findByRole("button", { name: /project\.ts/ }),
    ).toBeTruthy();

    const wasNotCanceled = fireEvent.keyDown(editor, { key: "Escape" });
    expect(wasNotCanceled).toBe(false);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /project\.ts/ })).toBeNull();
    });

    fireEvent.click(editor);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /project\.ts/ })).toBeNull();
    });
  });

  it("emits one controlled change when applying a mention", async () => {
    const onChangeSpy = vi.fn();
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Open @src/com",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/components",
            name: "components",
            replacement: "src/components/",
          },
        ]}
        onChangeSpy={onChangeSpy}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /components/,
    });
    onChangeSpy.mockClear();
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Open @src/components/ ");
    });
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
  });

  it("renders mixed thread, workspace path, and thread-storage suggestions", async () => {
    const { container } = render(
      <PromptBoxHarness
        initialDraft={{
          text: "Please check @pro",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "thread",
            path: "thread:thr_project",
            replacement: "thread:thr_project",
            projectId: "proj_current",
            threadId: "thr_project",
            title: "Project planning",
          },
          {
            kind: "thread",
            path: "thread:thr_standard_project",
            replacement: "thread:thr_standard_project",
            projectId: "proj_other",
            projectName: "Marketing Site",
            threadId: "thr_standard_project",
            title: "Project implementation",
          },
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "src/project.ts",
            name: "project.ts",
            replacement: "src/project.ts",
          },
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/projects",
            name: "projects",
            replacement: "src/projects/",
          },
          {
            kind: "path",
            source: "thread-storage",
            entryKind: "file",
            path: "notes/project.md",
            name: "project.md",
            replacement: "thread-storage:notes/project.md",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(await screen.findByText("Threads")).toBeTruthy();
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByText("Thread storage")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Project planning$/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Project implementation/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Marketing Site/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /project\.ts/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /projects/ })).toBeTruthy();
    expect(
      container.querySelector('[data-icon="MessageSquare"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-icon="File"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Folder"]')).not.toBeNull();
    expect(screen.queryByText("Paths")).toBeNull();
    expect(screen.queryByText("Folder")).toBeNull();
  });

  it("inserts workspace folder mentions with trailing slash", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Open @src/com",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/components",
            name: "components",
            replacement: "src/components/",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /components/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Open @src/components/ ");
    });
  });

  it("inserts thread-storage folder mentions with source-qualified text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Use @notes",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "thread-storage",
            entryKind: "directory",
            path: "notes",
            name: "notes",
            replacement: "thread-storage:notes/",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /notes/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Use @thread-storage:notes/ ");
    });
  });
});

describe("PromptBoxInternal history navigation", () => {
  it("recalls the newest history entry when the input is empty", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[
          { text: "latest command", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });
  });

  it("navigates selected history entries at the absolute end and restores the empty draft", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[
          { text: "latest command", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);

    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowDown",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "",
      key: "ArrowDown",
      editor,
    });
  });

  it("does not intercept ArrowUp for an unselected non-empty draft at the absolute end", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "working draft", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    pressIgnoredHistoryArrow({
      expectedValue: "working draft",
      key: "ArrowUp",
      editor,
    });
  });

  it("does not intercept ArrowUp or ArrowDown for a selected entry unless the caret is at the end", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });

    setEditorSelection(editor, 3);
    pressIgnoredHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });

    setEditorSelection(editor, 3);
    pressIgnoredHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowDown",
      editor,
    });
  });

  it("does not overwrite an attachment-only draft", () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [
            {
              type: "localFile",
              path: "/tmp/spec.md",
              name: "spec.md",
              sizeBytes: 42,
              mimeType: "text/markdown",
            },
          ],
        }}
        historyEntries={[{ text: "history command", attachments: [] }]}
      />,
    );

    const editor = getEditor();
    expect(screen.queryByText("spec.md")).not.toBeNull();

    setEditorSelection(editor, 0);
    pressIgnoredHistoryArrow({
      expectedValue: "",
      key: "ArrowUp",
      editor,
    });

    expect(screen.queryByText("spec.md")).not.toBeNull();
  });

  it("gives selected mention-like history entries precedence over mention navigation", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[
          { text: "@rea", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "README.md",
            name: "README.md",
            replacement: "README.md",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "@rea",
      key: "ArrowUp",
      editor,
    });
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    setEditorSelection(editor, getDraftText().length);
    await pressHistoryArrow({
      expectedValue: "",
      key: "ArrowDown",
      editor,
    });

    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "@rea",
      key: "ArrowUp",
      editor,
    });
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    setEditorSelection(editor, getDraftText().length);
    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      editor,
    });
  });

  it("preserves ordinary mention navigation for typed mention drafts", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "@rea", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "README.md",
            name: "README.md",
            replacement: "README.md",
          },
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "src/App.tsx",
            name: "App.tsx",
            replacement: "src/App.tsx",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    const wasNotCanceled = fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(wasNotCanceled).toBe(false);

    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      expect(getDraftText()).toBe("@src/App.tsx ");
    });
  });

  it("clears the active history session when the reset key changes", async () => {
    const { rerender } = render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-1"
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    await pressHistoryArrow({
      expectedValue: "history command",
      key: "ArrowUp",
      editor,
    });

    rerender(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-2"
      />,
    );

    setEditorSelection(editor, getDraftText().length);
    pressIgnoredHistoryArrow({
      expectedValue: "history command",
      key: "ArrowDown",
      editor,
    });
  });
});

interface CommandConfigArgs {
  trigger: "/" | "$";
  suggestions: ProviderCommandSuggestion[];
}

function makeCommandConfig({
  trigger,
  suggestions,
}: CommandConfigArgs): TypeaheadCommandConfig {
  return {
    trigger,
    suggestions,
    isLoading: false,
    isError: false,
    onQueryChange: () => {},
  };
}

function makeCommandSuggestion(
  overrides: Partial<ProviderCommandSuggestion> = {},
): ProviderCommandSuggestion {
  return {
    kind: "command",
    name: "review",
    source: "skill",
    origin: "project",
    description: null,
    argumentHint: null,
    ...overrides,
  };
}

describe("PromptBoxInternal command typeahead", () => {
  it("shows the command menu and inserts a slash token as plain text on Enter", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "/rev", attachments: [] }}
        historyEntries={[]}
        command={makeCommandConfig({
          trigger: "/",
          suggestions: [makeCommandSuggestion({ name: "review" })],
        })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(await screen.findByText("Skills")).toBeTruthy();
    const commandButton = await screen.findByRole("button", {
      name: /review/,
    });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("/review ");
    });
    // Plain text, not a pill node — and no mention range recorded.
    expect(editor.querySelector('[data-prompt-mention="true"]')).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
    expect(commandButton).toBeTruthy();
  });

  it("inserts a dollar token as plain text for a codex command", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "$pr", attachments: [] }}
        historyEntries={[]}
        command={makeCommandConfig({
          trigger: "$",
          suggestions: [makeCommandSuggestion({ name: "prd" })],
        })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const commandButton = await screen.findByRole("button", { name: /prd/ });
    fireEvent.mouseDown(commandButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("$prd ");
    });
    expect(editor.querySelector('[data-prompt-mention="true"]')).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("renders command name, description, and argument hint", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "/rev", attachments: [] }}
        historyEntries={[]}
        command={makeCommandConfig({
          trigger: "/",
          suggestions: [
            makeCommandSuggestion({
              name: "review",
              description: "Review the current diff",
              argumentHint: "[path]",
            }),
          ],
        })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(await screen.findByText("review")).toBeTruthy();
    expect(screen.getByText("Review the current diff")).toBeTruthy();
    expect(screen.getByText("[path]")).toBeTruthy();
  });

  it("dismisses on Escape, preserves the typed token, and stays closed in range", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "/rev", attachments: [] }}
        historyEntries={[]}
        command={makeCommandConfig({
          trigger: "/",
          suggestions: [makeCommandSuggestion({ name: "review" })],
        })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(await screen.findByRole("button", { name: /review/ })).toBeTruthy();

    const wasNotCanceled = fireEvent.keyDown(editor, { key: "Escape" });
    expect(wasNotCanceled).toBe(false);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /review/ })).toBeNull();
    });
    // Literal text is untouched by the dismissal.
    expect(getDraftText()).toBe("/rev");

    // Caret stays inside the dismissed `[from, to]` token span — no re-open.
    fireEvent.click(editor);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /review/ })).toBeNull();
    });
  });

  it("does not open the menu when the command list is empty", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "/rev", attachments: [] }}
        historyEntries={[]}
        command={makeCommandConfig({ trigger: "/", suggestions: [] })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    await waitForAnimationFrame();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByText("Failed to load commands")).toBeNull();
  });

  it("keeps keyboard nav aligned with the visual section order across sections", async () => {
    // The server returns commands already grouped in the menu's visual section
    // order (skills → project commands → user commands). The composer walks this
    // flat order for keyboard nav while the menu re-buckets it into the same
    // sections, so highlight/Arrow/Enter must track the rendered rows top to
    // bottom. This spans all three sections.
    //
    // This catches the flat-vs-section bug: before the server sorted by section
    // rank it returned a name-alphabetical order (`a-user`, `m-skill`,
    // `z-project`) that the menu re-bucketed to `m-skill`, `z-project`,
    // `a-user`. Flat index 0 (`a-user`) is then rendered LAST, so selectedIndex
    // 0 would highlight the bottom row instead of the top, and Enter would apply
    // `a-user` while `m-skill` looked selected. With the section-first sort the
    // flat order equals the rendered order and the assertions below hold.
    render(
      <PromptBoxHarness
        initialDraft={{ text: "/x", attachments: [] }}
        historyEntries={[]}
        command={makeCommandConfig({
          trigger: "/",
          suggestions: [
            makeCommandSuggestion({
              name: "m-skill",
              source: "skill",
              origin: "project",
            }),
            makeCommandSuggestion({
              name: "z-project",
              source: "command",
              origin: "project",
            }),
            makeCommandSuggestion({
              name: "a-user",
              source: "command",
              origin: "user",
            }),
          ],
        })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    await screen.findByText("Skills");
    expect(screen.getByText("Project commands")).toBeTruthy();
    expect(screen.getByText("User commands")).toBeTruthy();

    // Visual (DOM) order matches the section order, top to bottom.
    const commandRows = screen
      .getAllByRole("button")
      .filter((button) =>
        ["m-skill", "z-project", "a-user"].includes(
          button.textContent?.trim() ?? "",
        ),
      );
    expect(commandRows.map((row) => row.textContent?.trim())).toEqual([
      "m-skill",
      "z-project",
      "a-user",
    ]);

    const isHighlighted = (row: HTMLElement): boolean =>
      row.classList.contains("bg-state-active");

    // selectedIndex starts at 0 → the FIRST visual row is highlighted.
    await waitFor(() => {
      expect(isHighlighted(commandRows[0]!)).toBe(true);
    });
    expect(isHighlighted(commandRows[1]!)).toBe(false);
    expect(isHighlighted(commandRows[2]!)).toBe(false);

    // ArrowDown walks the rows top-to-bottom in visual order.
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    await waitFor(() => {
      expect(isHighlighted(commandRows[1]!)).toBe(true);
    });
    expect(isHighlighted(commandRows[0]!)).toBe(false);
    expect(isHighlighted(commandRows[2]!)).toBe(false);

    // Enter applies the visually-highlighted command (the second row).
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitForAnimationFrame();
    await waitFor(() => {
      expect(getDraftText()).toBe("/z-project ");
    });
  });

  it("still inserts a mention pill while a command trigger is configured", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "Open @src/com", attachments: [] }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/components",
            name: "components",
            replacement: "src/components/",
          },
        ]}
        command={makeCommandConfig({
          trigger: "/",
          suggestions: [makeCommandSuggestion({ name: "review" })],
        })}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /components/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Open @src/components/ ");
    });
    // The mention still inserts a pill node and records a mention range.
    expect(
      editor.querySelector('[data-prompt-mention="true"]'),
    ).not.toBeNull();
    expect(getDraftMentionCount()).toBe(1);
  });
});
