import { appendQuoteAndAttachmentsToDraft } from "@bb/client-core";
// @vitest-environment jsdom

import { createCoreComposerActions } from "@/lib/plugin-composer-handle";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPromptDraftAccessor,
  submitPromptDraft,
  usePromptDraftController,
  usePromptDraftInputEmpty,
  usePromptDraftInputThreadIds,
  usePromptDraftSnapshot,
  usePromptDraftStorage,
} from "./usePromptDraftStorage";

const NEW_THREAD_DRAFT_KEY = "bb.promptbox.contents-draft-3";
const LEGACY_PROJECT_DRAFT_KEY = "bb.promptbox.contents-proj_prompt-draft-3";

function storedDraft(text: string): string {
  return JSON.stringify({ text, attachments: [] });
}

let scopeCounter = 0;
function uniqueScope() {
  scopeCounter += 1;
  return {
    kind: "thread" as const,
    projectId: `proj-quote-test-${scopeCounter}`,
    threadId: "thr-1",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePromptDraftStorage", () => {
  it("keeps deferred text writes readable and serializes at the persist boundary", () => {
    vi.useFakeTimers();
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      result.current.setTextAndMentions("large pending draft", []);
    });

    expect(result.current.text).toBe("large pending draft");
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();
    act(() => vi.advanceTimersByTime(249));
    expect(window.localStorage.getItem(result.current.storageKey)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("large pending draft"),
    );
  });

  it("lets an immediate write replace a pending deferred write", () => {
    vi.useFakeTimers();
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      result.current.setTextAndMentions("stale pending draft", []);
      result.current.setDraft({
        text: "immediate replacement",
        mentions: [],
        attachments: [],
      });
    });

    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("immediate replacement"),
    );
    act(() => vi.advanceTimersByTime(250));
    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("immediate replacement"),
    );
  });

  it("keeps the in-memory draft when localStorage rejects the write", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));
    act(() => {
      result.current.setDraft({ text: "small", mentions: [], attachments: [] });
    });
    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("small"),
    );

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      act(() => {
        result.current.setDraft({
          text: "too large for storage",
          mentions: [],
          attachments: [],
        });
      });
    } finally {
      setItem.mockRestore();
    }

    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("small"),
    );
    expect(result.current.text).toBe("too large for storage");
    expect(result.current.getCurrent().text).toBe("too large for storage");
    expect(getPromptDraftAccessor(scope).getCurrent().text).toBe(
      "too large for storage",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("flushes a deferred write when the page is hidden", () => {
    vi.useFakeTimers();
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      result.current.setTextAndMentions("flush before leaving", []);
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(window.localStorage.getItem(result.current.storageKey)).toBe(
      storedDraft("flush before leaving"),
    );
  });

  it("subscribes to draft presence for a batch of threads", () => {
    const projectId = "proj-batch-drafts";
    const threadRefs = [
      { id: "thr-batch-a", projectId },
      { id: "thr-batch-b", projectId },
    ];
    const { result } = renderHook(() => ({
      draft: usePromptDraftStorage({
        kind: "thread",
        projectId,
        threadId: "thr-batch-b",
      }),
      inputThreadIds: usePromptDraftInputThreadIds(threadRefs),
    }));

    expect([...result.current.inputThreadIds]).toEqual([]);

    act(() => {
      result.current.draft.setDraft({
        text: "Unsubmitted",
        mentions: [],
        attachments: [],
      });
    });

    expect([...result.current.inputThreadIds]).toEqual(["thr-batch-b"]);

    act(() => result.current.draft.clear());
    expect([...result.current.inputThreadIds]).toEqual([]);
  });

  it("does not re-read storage or re-render the batch when a draft edit keeps presence", () => {
    const projectId = "proj-batch-keystrokes";
    const threadRefs = Array.from({ length: 30 }, (_, index) => ({
      id: `thr-batch-${index}`,
      projectId,
    }));
    const composer = getPromptDraftAccessor({
      kind: "thread",
      projectId,
      threadId: "thr-batch-3",
    });
    let batchRenders = 0;
    const { result, rerender } = renderHook(() => {
      batchRenders += 1;
      return usePromptDraftInputThreadIds(threadRefs);
    });
    act(() => {
      composer.setDraft({ text: "first", mentions: [], attachments: [] });
    });
    expect([...result.current]).toEqual(["thr-batch-3"]);

    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const presenceReads = () =>
      getItem.mock.calls.filter(([key]) => String(key).includes(projectId))
        .length;
    rerender();
    expect(presenceReads()).toBe(0);

    const rendersBefore = batchRenders;
    act(() => {
      composer.setDraft({
        text: "first keystroke",
        mentions: [],
        attachments: [],
      });
    });
    expect(presenceReads()).toBeLessThanOrEqual(1);
    expect(batchRenders).toBe(rendersBefore);

    act(() => {
      composer.setDraft({ text: "", mentions: [], attachments: [] });
    });
    expect([...result.current]).toEqual([]);
    expect(batchRenders).toBe(rendersBefore + 1);
    getItem.mockRestore();
  });

  it("uses project-agnostic storage for new-thread prompt contents", () => {
    window.localStorage.setItem(
      LEGACY_PROJECT_DRAFT_KEY,
      storedDraft("project draft"),
    );
    window.localStorage.setItem(
      NEW_THREAD_DRAFT_KEY,
      storedDraft("global draft"),
    );

    const { result } = renderHook(() =>
      usePromptDraftStorage({ kind: "new-thread" }),
    );

    expect(result.current.storageKey).toBe(NEW_THREAD_DRAFT_KEY);
    expect(result.current.text).toBe("global draft");

    act(() => {
      result.current.setDraft({
        text: "updated global draft",
        mentions: [],
        attachments: [],
      });
    });

    expect(window.localStorage.getItem(NEW_THREAD_DRAFT_KEY)).toBe(
      storedDraft("updated global draft"),
    );
    expect(window.localStorage.getItem(LEGACY_PROJECT_DRAFT_KEY)).toBe(
      storedDraft("project draft"),
    );
  });

  it("keeps thread follow-up drafts scoped to the thread", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({
        kind: "thread",
        projectId: "proj_prompt",
        threadId: "thr_followup",
      }),
    );

    expect(result.current.storageKey).toBe(
      "bb.promptbox.contents-proj_prompt-thr_followup-3",
    );
  });

  it("keeps automation edit drafts scoped to the automation", () => {
    const { result } = renderHook(() =>
      usePromptDraftStorage({
        kind: "automation-edit",
        automationId: "auto_watchdog",
      }),
    );

    expect(result.current.storageKey).toBe(
      "bb.promptbox.contents-automation-edit-auto_watchdog-3",
    );
  });
});

function addQuote(
  source: ReturnType<typeof getPromptDraftAccessor>,
  text: string,
  attachments?: Parameters<typeof appendQuoteAndAttachmentsToDraft>[2],
) {
  const composer = createCoreComposerActions({ ...source, focus: () => {} });
  composer.replace((current) =>
    appendQuoteAndAttachmentsToDraft(current, text, attachments ?? []),
  );
}

describe("composer quote persistence", () => {
  it("keeps an imperative draft-action consumer unsubscribed from composer writes", () => {
    const scope = uniqueScope();
    let consumerRenders = 0;
    let draftActions: ReturnType<typeof getPromptDraftAccessor> | undefined;

    function DraftActionConsumer() {
      consumerRenders += 1;
      draftActions = getPromptDraftAccessor(scope);
      return null;
    }

    render(<DraftActionConsumer />);
    const rendersBeforeTyping = consumerRenders;
    const composer = renderHook(() => usePromptDraftStorage(scope));

    act(() => {
      composer.result.current.setTextAndMentions("typed reply", []);
    });

    expect(consumerRenders).toBe(rendersBeforeTyping);
    expect(draftActions?.storageKey).toBe(composer.result.current.storageKey);

    act(() => {
      if (draftActions) addQuote(draftActions, "selected text");
    });

    expect(composer.result.current.text).toBe("typed reply\n> selected text\n");
    expect(consumerRenders).toBe(rendersBeforeTyping);
  });

  it("stacks a second quote below the first, separated by a blank line", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() => addQuote(result.current, "first"));
    act(() => addQuote(result.current, "second"));

    expect(result.current.text).toBe("> first\n\n> second\n");
  });

  it("adds quote attachments to the draft and persists them", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() => usePromptDraftStorage(scope));

    act(() =>
      addQuote(result.current, "review this", [
        {
          type: "localFile",
          path: "uploads/spec.md",
          name: "spec.md",
          sizeBytes: 0,
        },
      ]),
    );

    expect(result.current.text).toBe("> review this\n");
    expect(result.current.attachments).toEqual([
      {
        type: "localFile",
        path: "uploads/spec.md",
        name: "spec.md",
        sizeBytes: 0,
      },
    ]);
    expect(
      window.localStorage.getItem(result.current.storageKey ?? ""),
    ).toContain("uploads/spec.md");
  });

  it("syncs an added quote live across two instances of the same scope", () => {
    const scope = uniqueScope();
    const first = renderHook(() => usePromptDraftStorage(scope));
    const second = renderHook(() => usePromptDraftStorage(scope));

    act(() => addQuote(first.result.current, "shared selection"));

    expect(second.result.current.text).toBe("> shared selection\n");
  });
});

describe("usePromptDraftController", () => {
  it("returns stable methods and never re-renders its caller on draft writes", () => {
    const scope = uniqueScope();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      const controller = usePromptDraftController(scope);
      return { controller, inputEmpty: usePromptDraftInputEmpty(controller) };
    });
    const initialController = result.current.controller;
    const rendersBefore = renders;

    act(() => initialController.setTextAndMentions("h", []));
    const rendersAfterFirstKey = renders;
    for (const text of ["he", "hel", "hell", "hello"]) {
      act(() => initialController.setTextAndMentions(text, []));
    }

    expect(rendersAfterFirstKey).toBe(rendersBefore + 1);
    expect(renders).toBe(rendersAfterFirstKey);
    expect(result.current.inputEmpty).toBe(false);
    expect(result.current.controller).toBe(initialController);
    expect(initialController.getCurrent().text).toBe("hello");
  });

  it("follows the live draft through the snapshot hook", () => {
    const scope = uniqueScope();
    const { result } = renderHook(() =>
      usePromptDraftSnapshot(usePromptDraftController(scope)),
    );

    act(() =>
      getPromptDraftAccessor(scope).setDraft({
        text: "typed",
        mentions: [],
        attachments: [],
      }),
    );

    expect(result.current.text).toBe("typed");
  });
});

describe("prompt submission recovery", () => {
  it("preserves newer input on acceptance and removes the recovery copy", async () => {
    const controller = getPromptDraftAccessor(uniqueScope());
    controller.setDraft({ text: "sent work", mentions: [], attachments: [] });
    const submitted = controller.getCurrent();
    let accept = () => {};
    const sending = submitPromptDraft(
      controller,
      submitted,
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    expect(controller.getCurrent().text).toBe("");
    expect(
      window.localStorage.getItem(
        `${controller.storageKey}.pending-submissions`,
      ),
    ).toContain("sent work");
    controller.setTextAndMentions("new work", []);
    accept();
    await sending;
    expect(controller.getCurrent().text).toBe("new work");
    expect(
      window.localStorage.getItem(
        `${controller.storageKey}.pending-submissions`,
      ),
    ).toBeNull();
  });

  it("recovers interrupted submissions after a reload alongside newer persisted input", async () => {
    const scope = uniqueScope();
    const controller = getPromptDraftAccessor(scope);
    controller.setDraft({
      text: "interrupted work",
      mentions: [],
      attachments: [],
    });
    let accept = () => {};
    const sending = submitPromptDraft(
      controller,
      controller.getCurrent(),
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    controller.setDraft({ text: "new work", mentions: [], attachments: [] });
    vi.resetModules();
    const reloadedStorage = await import("./usePromptDraftStorage");
    const reloaded = reloadedStorage.getPromptDraftAccessor(scope);
    expect(reloaded.getCurrent().text).toBe("interrupted work\n\nnew work");
    expect(reloaded.getCurrent().text).toBe("interrupted work\n\nnew work");
    expect(
      window.localStorage.getItem(
        `${controller.storageKey}.pending-submissions`,
      ),
    ).toBeNull();
    expect(window.localStorage.getItem(controller.storageKey)).toContain(
      "interrupted work",
    );
    accept();
    await sending;
  });

  it("isolates concurrent submissions across threads, projects, and composers", async () => {
    const scope = uniqueScope();
    const scopes = [
      scope,
      { ...scope, threadId: "thr-2" },
      { ...scope, projectId: "other-project" },
      { kind: "plugin-new-thread" as const, key: scope.projectId },
    ];
    const controllers = scopes.map(getPromptDraftAccessor);
    const completions: Array<() => void> = [];
    const sending = controllers.map((controller, index) => {
      controller.setDraft({
        text: `work ${index}`,
        mentions: [],
        attachments: [],
      });
      return submitPromptDraft(
        controller,
        controller.getCurrent(),
        () =>
          new Promise<void>((resolve) => {
            completions.push(resolve);
          }),
      );
    });
    controllers[0].setDraft({
      text: "second submission",
      mentions: [],
      attachments: [],
    });
    const second = submitPromptDraft(
      controllers[0],
      controllers[0].getCurrent(),
      () =>
        new Promise<void>((resolve) => {
          completions.push(resolve);
        }),
    );
    completions[0]();
    await sending[0];
    expect(
      window.localStorage.getItem(
        `${controllers[0].storageKey}.pending-submissions`,
      ),
    ).toContain("second submission");
    vi.resetModules();
    const reloaded = await import("./usePromptDraftStorage");
    expect(
      scopes.map(
        (scope) => reloaded.getPromptDraftAccessor(scope).getCurrent().text,
      ),
    ).toEqual(["second submission", "work 1", "work 2", "work 3"]);
    completions.slice(1).forEach((complete) => complete());
    await Promise.all([...sending, second]);
  });

  it("does not resurrect an accepted submission after reloading storage", async () => {
    const scope = uniqueScope();
    const controller = getPromptDraftAccessor(scope);
    controller.setDraft({
      text: "accepted work",
      mentions: [],
      attachments: [],
    });
    await submitPromptDraft(
      controller,
      controller.getCurrent(),
      async () => undefined,
    );
    vi.resetModules();
    const reloaded = await import("./usePromptDraftStorage");
    expect(reloaded.getPromptDraftAccessor(scope).getCurrent().text).toBe("");
    expect(
      window.localStorage.getItem(
        `${controller.storageKey}.pending-submissions`,
      ),
    ).toBeNull();
  });

  it("keeps the draft and does not send when the recovery copy cannot be persisted", async () => {
    const controller = getPromptDraftAccessor(uniqueScope());
    controller.setDraft({
      text: "valuable work",
      mentions: [],
      attachments: [],
    });
    const submit = vi.fn();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw new Error("Storage full");
      });
    try {
      await expect(
        submitPromptDraft(controller, controller.getCurrent(), submit),
      ).rejects.toThrow("Storage full");
      expect(submit).not.toHaveBeenCalled();
      expect(controller.getCurrent().text).toBe("valuable work");
      expect(window.localStorage.getItem(controller.storageKey)).toContain(
        "valuable work",
      );
    } finally {
      setItem.mockRestore();
    }
  });
});
