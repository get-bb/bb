import { appendQuoteAndAttachmentsToDraft } from "@bb/client-core";
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
import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import {
  notifyComposerSubmitted,
  subscribeComposerSubmitted,
} from "./composer-submissions";
import {
  composerHandleController,
  composerDraftFromPromptDraft,
  createCoreComposerActions,
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

  it("keeps onSubmitted listeners when the composer's scope changes", () => {
    const controllerFor = (scope: PluginComposerScope) =>
      composerHandleController(
        "demo",
        makeTarget(emptyDraft, { scope }).target,
        {
          setTextEffect: () => {},
          setInputLock: () => {},
          onSubmitted: (listener) =>
            subscribeComposerSubmitted(scope, listener),
        },
      );
    const first: PluginComposerScope = { kind: "new-thread", projectId: "a" };
    const second: PluginComposerScope = { kind: "new-thread", projectId: "b" };
    const binding = createComposerHandleBinding(KEY, controllerFor(first));
    const listener = vi.fn();
    const unsubscribe = binding.handle.onSubmitted(listener);

    notifyComposerSubmitted(first);
    expect(listener).toHaveBeenCalledTimes(1);
    binding.update(controllerFor(second));
    notifyComposerSubmitted(first);
    expect(listener).toHaveBeenCalledTimes(1);
    notifyComposerSubmitted(second);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    notifyComposerSubmitted(second);
    expect(listener).toHaveBeenCalledTimes(2);
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
    handle.replace((current) => ({ ...current, text: "updated" }));
    expect(second.current().text).toBe("updated");
    expect(first.current().text).toBe("one");
  });
});

describe.each(["core", "plugin"] as const)(
  "%s composer draft actions",
  (caller) => {
    const actionsFor = (source: ComposerSource) =>
      caller === "core"
        ? createCoreComposerActions(source)
        : makeHandle(source).handle;
    const quote = (
      actions: ReturnType<typeof actionsFor>,
      text: string,
      attachments?: Parameters<typeof appendQuoteAndAttachmentsToDraft>[2],
    ) => {
      actions.replace((current) =>
        appendQuoteAndAttachmentsToDraft(current, text, attachments ?? []),
      );
      actions.focus();
    };
    const attachment = {
      type: "localFile",
      path: "attachments/spec.txt",
      name: "spec.txt",
      sizeBytes: 12,
    } as const;

    it("restores a structured history snapshot atomically and replaces pills even when text is unchanged", () => {
      const history: PromptDraftState = {
        text: "x".repeat(44),
        mentions: MENTIONS,
        attachments: [attachment],
      };
      const stored = makeTarget({
        text: "newer draft",
        mentions: [],
        attachments: [],
      });
      const observations: PromptDraftState[] = [];
      const actions = actionsFor({
        ...stored.target,
        setDraft(next) {
          stored.target.setDraft(next);
          observations.push(stored.current());
        },
      });
      actions.replace(composerDraftFromPromptDraft(history));
      expect(observations).toEqual([history]);
      expect(actions.draft.attachments).toEqual([attachment]);

      actions.replace({ text: history.text, mentions: [] });
      expect(stored.current()).toEqual({
        text: history.text,
        mentions: [],
        attachments: [attachment],
      });
      actions.replace({
        text: "",
        mentions: [],
        attachments: [],
      });
      expect(stored.current()).toEqual(emptyDraft);
      expect(observations).toHaveLength(3);
    });

    it("updates from the latest complete draft and preserves earlier snapshots", () => {
      const stored = makeTarget({
        text: "original",
        mentions: [],
        attachments: [],
      });
      const actions = actionsFor(stored.target);
      const snapshot = actions.draft;
      expect(actions.draft).toBe(snapshot);
      stored.target.setDraft({
        text: "latest",
        mentions: [],
        attachments: [attachment],
      });
      actions.replace((current) => ({ ...current, text: `${current.text}!` }));
      actions.replace((current) => ({ ...current, text: `${current.text}?` }));
      expect(stored.current()).toEqual({
        text: "latest!?",
        mentions: [],
        attachments: [attachment],
      });
      expect(snapshot).toEqual({
        text: "original",
        mentions: [],
        attachments: [],
      });
      const unchanged = stored.current();
      actions.replace((current) => current);
      expect(stored.current()).toBe(unchanged);
    });

    it("rejects invalid, throwing, and mutating updaters without altering any draft content", () => {
      const stored = makeTarget({
        text: "x".repeat(44),
        mentions: MENTIONS,
        attachments: [attachment],
      });
      const actions = actionsFor(stored.target);
      const original = stored.current();
      expect(() =>
        actions.replace((current) => ({ ...current, text: "" })),
      ).toThrow("Invalid composer draft");
      expect(() =>
        actions.replace(() => {
          throw new Error("transform failed");
        }),
      ).toThrow("transform failed");
      expect(() =>
        actions.replace((current) => {
          current.mentions[0]!.label = "mutated";
          return current;
        }),
      ).toThrow();
      expect(() =>
        actions.replace((current) => {
          current.attachments[0]!.path = "changed";
          return current;
        }),
      ).toThrow();
      expect(stored.current()).toBe(original);
      expect(actions.draft.mentions[0]!.label).toBe("Fix search");
      expect(actions.draft.attachments[0]!.path).toBe(attachment.path);
    });

    it("quotes with attachments in one write, preserves existing pills, and deduplicates attachment-only additions", () => {
      const initial: PromptDraftState = {
        text: "x".repeat(44),
        mentions: MENTIONS,
        attachments: [attachment],
      };
      const stored = makeTarget(initial);
      const observations: PromptDraftState[] = [];
      const focused: PromptDraftState[] = [];
      const actions = actionsFor({
        ...stored.target,
        setDraft(next) {
          stored.target.setDraft(next);
          observations.push(stored.current());
        },
        focus: () => focused.push(stored.current()),
      });
      const image = {
        type: "localImage",
        path: "attachments/screen.png",
        name: "screen.png",
        sizeBytes: 24,
      } as const;
      quote(actions, "first\r\nsecond", [attachment, image, image]);
      expect(observations).toEqual([
        {
          ...initial,
          text: `${initial.text}\n> first\n> second\n`,
          attachments: [attachment, image],
        },
      ]);
      expect(focused).toEqual(observations);
      const other = { ...attachment, path: "attachments/other.txt" };
      quote(actions, "", [other]);
      expect(stored.current().attachments).toEqual([attachment, image, other]);
      expect(observations).toHaveLength(2);
    });

    it.each([
      {
        text: "x",
        mentions: [
          { kind: "thread", threadId: "t", label: "t", from: 0, to: 2 },
        ],
      },
      {
        text: "xx",
        mentions: [
          { kind: "thread", threadId: "t", label: "t", from: 0, to: 2 },
          { kind: "thread", threadId: "t", label: "t", from: 1, to: 2 },
        ],
      },
      {
        text: "x",
        mentions: [{ kind: "unknown", from: 0, to: 1, label: "x" }],
      },
      {
        text: "x",
        mentions: [],
        attachments: [
          { type: "localFile", path: "", name: "file", sizeBytes: 1 },
        ],
      },
    ])(
      "rejects malformed replacement without changing the saved draft: %j",
      (invalid) => {
        const stored = makeTarget({
          ...emptyDraft,
          text: "keep me",
          attachments: [attachment],
        });
        const before = stored.current();
        const actions = actionsFor(stored.target);
        expect(() =>
          actions.replace(invalid as Parameters<typeof actions.replace>[0]),
        ).toThrow("Invalid composer draft");
        expect(stored.current()).toBe(before);
      },
    );

    it("rejects invalid attachment quotes and writes after an ephemeral editor closes", () => {
      let available = true;
      const stored = makeTarget(emptyDraft, { isAvailable: () => available });
      const actions = actionsFor(stored.target);
      expect(() =>
        quote(actions, "must not append", [{ ...attachment, sizeBytes: -1 }]),
      ).toThrow("Invalid composer draft");
      expect(stored.current()).toEqual(emptyDraft);
      available = false;
      expect(() => quote(actions, "closed", [attachment])).toThrow(
        "no longer available",
      );
      expect(() => actions.replace({ text: "closed", mentions: [] })).toThrow(
        "no longer available",
      );
      expect(stored.current()).toEqual(emptyDraft);
    });
  },
);
