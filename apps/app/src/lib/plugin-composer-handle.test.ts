import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptTextMention } from "@bb/domain";
import type { PromptDraftState } from "@bb/client-core";
import type { ComposerEditorState } from "@get-bb/plugin-sdk/internal/composer-handle";
import {
  clearComposerEditorBridge,
  publishComposerEditorBridge,
  type ComposerEditorBridge,
} from "./composer-editor-registry";
import { createComposerHandleBinding } from "@get-bb/plugin-sdk/internal/composer-handle";
import {
  composerHandleController,
  type ComposerSource,
} from "./plugin-composer-handle";

const KEY = "composer-handle-test";

const READY: ComposerEditorState = {
  layout: "expanded",
  isRunning: false,
  isSubmitting: false,
  isSubmittingBlocked: false,
  submittingBlockedReason: null,
  isAttaching: false,
  attachmentError: null,
};

const published: ComposerEditorBridge[] = [];

function publishEditor(
  state: Partial<ComposerEditorState> = {},
  insertAtCursor: ComposerEditorBridge["insertAtCursor"] = () => true,
): ComposerEditorBridge {
  const bridge: ComposerEditorBridge = {
    host: {
      scope: { kind: "thread", threadId: "thr_1" },
      textEffectKey: KEY,
      getCurrent: () => ({ text: "", mentions: [], attachments: [] }),
      subscribeDraft: () => () => {},
      setDraft: () => {},
      focus: () => {},
    },
    pluginCustomizable: true,
    state: { ...READY, ...state },
    insertAtCursor,
  };
  publishComposerEditorBridge(KEY, bridge);
  published.push(bridge);
  return bridge;
}

afterEach(() => {
  for (const bridge of published.splice(0)) {
    clearComposerEditorBridge(KEY, bridge);
  }
  vi.restoreAllMocks();
});

const MENTIONS: PromptTextMention[] = [
  {
    start: 0,
    end: 15,
    resource: {
      kind: "thread",
      threadId: "thr_1",
      projectId: "proj_1",
      label: "Fix search",
    },
  },
  {
    start: 16,
    end: 29,
    resource: {
      kind: "path",
      source: "workspace",
      entryKind: "directory",
      path: "src/app",
      label: "app",
    },
  },
  {
    start: 30,
    end: 37,
    resource: {
      kind: "command",
      trigger: "/",
      name: "review",
      source: "skill",
      origin: "project",
      label: "review",
      argumentHint: null,
    },
  },
  {
    start: 38,
    end: 44,
    resource: {
      kind: "plugin",
      pluginId: "github",
      icon: null,
      itemId: "pr:get-bb/bb#1",
      label: "PR #1",
    },
  },
];

function makeTarget(
  initial: PromptDraftState,
  overrides: Partial<ComposerSource> = {},
) {
  let draft = initial;
  const target: ComposerSource = {
    textEffectKey: KEY,
    scope: { kind: "thread", threadId: "thr_1" },
    getCurrent: () => draft,
    setDraft: (next) => {
      draft = next;
    },
    isAvailable: () => true,
    focus: () => {},
    ...overrides,
  };
  return { target, current: () => draft };
}

function makeHandle(target: ComposerSource, pluginId = "demo") {
  return createComposerHandleBinding(
    KEY,
    composerHandleController(pluginId, target, {
      setTextEffect: () => {},
      setInputLock: () => {},
      onSubmitted: () => () => {},
    }),
  );
}

const emptyDraft: PromptDraftState = {
  text: "",
  mentions: [],
  attachments: [],
};

describe("composer handle", () => {
  it("round-trips every mention kind from draft through insert", () => {
    const source = makeTarget({
      text: "x".repeat(44),
      mentions: MENTIONS,
      attachments: [],
    });
    const mentions = makeHandle(source.target).handle.draft.mentions;
    expect(mentions.map((mention) => mention.kind)).toEqual([
      "thread",
      "path",
      "command",
      "plugin",
    ]);
    expect(mentions[3]).toMatchObject({
      pluginId: "github",
      provider: "pr",
      id: "get-bb/bb#1",
    });

    const destination = makeTarget(emptyDraft);
    makeHandle(destination.target).handle.insert([...mentions], { at: "end" });

    expect(destination.current().mentions.map((m) => m.resource)).toEqual(
      MENTIONS.map((mention) => mention.resource),
    );
    expect(destination.current().text).toBe(
      "@thread:thr_1@src/app//review@PR #1",
    );
  });

  it("inserts at the cursor through the mounted editor and refuses without one", () => {
    const insertAtCursor = vi.fn(() => true);
    publishEditor({}, insertAtCursor);
    const { target } = makeTarget(emptyDraft);
    const { handle } = makeHandle(target);

    handle.insert(["See ", { provider: "files", id: "a.ts", label: "a.ts" }]);
    expect(insertAtCursor).toHaveBeenCalledWith(
      {
        text: "See @a.ts",
        mentions: [
          {
            start: 4,
            end: 9,
            resource: {
              kind: "plugin",
              pluginId: "demo",
              icon: null,
              itemId: "files:a.ts",
              label: "a.ts",
            },
          },
        ],
      },
      false,
    );

    clearComposerEditorBridge(KEY, published.pop()!);
    expect(() => handle.insert("more")).toThrow(/isn't on screen/);
    expect(() =>
      handle.insert({ provider: "bad:id", id: "x", label: "x" }, { at: "end" }),
    ).toThrow(/Invalid mention provider/);
  });

  it("appends a cursor insert while the mounted editor is still initializing", () => {
    publishEditor({}, () => false);
    const { target, current } = makeTarget({
      text: "Hi",
      mentions: [],
      attachments: [],
    });

    makeHandle(target).handle.insert("there", { block: true });
    expect(current().text).toBe("Hi\n\nthere");
  });

  it("removes only its own mentions, rebases the rest, and keeps attachments", () => {
    const attachments: PromptDraftState["attachments"] = [];
    const pill = (pluginId: string, start: number): PromptTextMention => ({
      start,
      end: start + 4,
      resource: {
        kind: "plugin",
        pluginId,
        itemId: "annotation:1",
        label: "same",
        icon: null,
      },
    });
    const { target, current } = makeTarget({
      text: "same same tail",
      mentions: [pill("annotations", 0), pill("other", 5)],
      attachments,
    });

    makeHandle(target, "annotations").handle.removeMention({
      provider: "annotation",
      id: "1",
    });
    expect(current().text).toBe(" same tail");
    expect(current().mentions).toEqual([pill("other", 1)]);
    expect(current().attachments).toBe(attachments);
  });

  it("appends a block after existing text and keeps existing mentions", () => {
    const threadMention: PromptTextMention = {
      ...MENTIONS[0]!,
      start: 0,
      end: 13,
    };
    const { target, current } = makeTarget({
      text: "@thread:thr_1  \n",
      mentions: [threadMention],
      attachments: [],
    });
    const { handle } = makeHandle(target);

    handle.insert("Summary", { at: "end", block: true });
    expect(current().text).toBe("@thread:thr_1\n\nSummary");
    expect(current().mentions).toEqual([threadMention]);

    const empty = makeTarget(emptyDraft);
    makeHandle(empty.target).handle.insert("Summary", {
      at: "end",
      block: true,
    });
    expect(empty.current().text).toBe("Summary");
  });

  it("waits for uploads before submitting and rejects when one fails", async () => {
    const submit = vi.fn(async () => {});
    const { target } = makeTarget(
      { text: "ship it", mentions: [], attachments: [] },
      { submit },
    );
    const { handle } = makeHandle(target);

    publishEditor({
      isAttaching: true,
      isSubmittingBlocked: true,
      submittingBlockedReason: "Uploading attachments...",
    });
    const pending = handle.submit({ experimental_data: { kind: "draft" } });
    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
    publishEditor();
    await pending;
    expect(submit).toHaveBeenCalledWith(
      { experimental_data: { kind: "draft" } },
      { pluginId: "demo", data: { kind: "draft" } },
    );

    publishEditor({ isAttaching: true, isSubmittingBlocked: true });
    const failing = handle.submit({ sendAt: Date.now() + 60_000 });
    publishEditor({
      isAttaching: false,
      attachmentError: "Failed to attach: a.png",
    });
    await expect(failing).rejects.toThrow("Failed to attach: a.png");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("rejects submits the host's send button would block", async () => {
    const submit = vi.fn(async () => {});
    const { target } = makeTarget(emptyDraft, { submit });
    const { handle } = makeHandle(target);

    await expect(
      handle.submit({ sendAt: Date.now() + 60_000 }),
    ).rejects.toThrow(/isn't on screen/);
    publishEditor({
      isSubmittingBlocked: true,
      submittingBlockedReason: "Select a model.",
    });
    expect(handle.isSubmittingBlocked).toBe(true);
    expect(handle.submittingBlockedReason).toBe("Select a model.");
    await expect(
      handle.submit({ sendAt: Date.now() + 60_000 }),
    ).rejects.toThrow("Select a model.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("drops old-method writes with a warning and throws from new methods once the draft is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let available = true;
    const { target, current } = makeTarget(
      { text: "keep", mentions: [], attachments: [] },
      { isAvailable: () => available, submit: async () => {} },
    );
    const { handle } = makeHandle(target);

    available = false;
    handle.setText("lost");
    handle.experimental_removeMention({ provider: "p", id: "1" });
    expect(current().text).toBe("keep");
    expect(warn).toHaveBeenCalled();
    expect(() => handle.insert("x", { at: "end" })).toThrow(
      /no longer available/,
    );
    expect(() => handle.removeMention({ provider: "p", id: "1" })).toThrow(
      /no longer available/,
    );
    await expect(handle.submit({ sendAt: Date.now() + 1 })).rejects.toThrow(
      /no longer available/,
    );
  });

  it("keeps one handle object while reading the latest target", () => {
    const first = makeTarget({ text: "one", mentions: [], attachments: [] });
    const binding = makeHandle(first.target);
    const handle = binding.handle;
    const second = makeTarget({ text: "two", mentions: [], attachments: [] });

    binding.update(
      composerHandleController("demo", second.target, {
        setTextEffect: () => {},
        setInputLock: () => {},
        onSubmitted: () => () => {},
      }),
    );

    expect(binding.handle).toBe(handle);
    expect(handle.text).toBe("two");
    handle.setText("updated");
    expect(second.current().text).toBe("updated");
    expect(first.current().text).toBe("one");
  });
});
