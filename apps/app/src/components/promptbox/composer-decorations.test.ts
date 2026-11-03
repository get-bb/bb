import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerView } from "@get-bb/plugin-sdk";
import type { PromptTextMention } from "@bb/domain";
import {
  ULTRACODE_HIGHLIGHT_CLASS,
  composerDecorationSources,
  createDraftObserverRunner,
  findUltracodeRanges,
  type ComposerDraftObserver,
} from "./composer-decorations";

const threadView: ComposerView = {
  scope: { kind: "thread", threadId: "thr_1" },
  layout: "expanded",
  draft: { text: "", isEmpty: true, attachmentCount: 0 },
  run: { isRunning: false, isSubmitting: false },
};

const aliceMention: PromptTextMention = {
  start: 4,
  end: 9,
  resource: {
    kind: "plugin",
    pluginId: "sample",
    itemId: "people:alice",
    label: "Alice",
  },
};

function observer(
  onDraftChange: ComposerDraftObserver["onDraftChange"],
  customizationId = "observer",
): ComposerDraftObserver {
  return { pluginId: "sample", customizationId, onDraftChange };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("composerDecorationSources", () => {
  it("matches ultracode as a whole word, case-insensitively", () => {
    expect(findUltracodeRanges("run UltraCode and ultracode now")).toEqual([
      { from: 4, to: 13 },
      { from: 18, to: 27 },
    ]);
    expect(findUltracodeRanges("ultracodes myultracode supercode")).toEqual([]);
  });

  it("paints bb's highlight first, then plugin rules, then text effects", () => {
    const sources = composerDecorationSources(
      [
        {
          pluginId: "sample",
          customizationId: "todo",
          generation: 3,
          effects: [{ id: "todo", className: "todo", match: () => [] }],
        },
      ],
      [
        { pluginId: "sample", order: 1, effect: { className: "shimmer" } },
        { pluginId: "sample", order: 2, effect: { className: "" } },
      ],
    );

    expect(sources.map((source) => source.id)).toEqual([
      "host:ultracode",
      "sample/todo",
      "plugin-imperative:sample:1",
    ]);
    expect(sources[0]?.effects[0]?.className).toBe(ULTRACODE_HIGHLIGHT_CLASS);
    expect(sources[2]?.effects[0]?.match("abc")).toEqual([{ from: 0, to: 3 }]);
    expect(sources[2]?.effects[0]?.match("")).toEqual([]);
  });
});

describe("createDraftObserverRunner", () => {
  it("debounces observation and coalesces edits into the latest draft", () => {
    vi.useFakeTimers();
    const onDraftChange = vi.fn();
    const runner = createDraftObserverRunner(25);
    const observers = [observer(onDraftChange)];
    const mentions = [aliceMention];

    runner.update({ text: "ask Alice", mentions, view: threadView, observers });
    vi.advanceTimersByTime(24);
    expect(onDraftChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDraftChange).toHaveBeenCalledWith(
      {
        text: "ask Alice",
        mentions: [
          { from: 4, to: 9, provider: "people", id: "alice", label: "Alice" },
        ],
      },
      threadView,
    );

    onDraftChange.mockClear();
    runner.update({ text: "first", mentions: [], view: threadView, observers });
    runner.update({
      text: "second",
      mentions: [],
      view: threadView,
      observers,
    });
    vi.advanceTimersByTime(25);
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onDraftChange.mock.calls[0]?.[0].text).toBe("second");
    runner.dispose();
  });

  it("re-notifies only when the draft, observers or scope change", () => {
    vi.useFakeTimers();
    const onDraftChange = vi.fn();
    const runner = createDraftObserverRunner(25);
    const observers = [observer(onDraftChange)];
    const mentions: PromptTextMention[] = [];
    const update = (
      view: ComposerView,
      nextObservers: readonly ComposerDraftObserver[] = observers,
    ) => {
      runner.update({ text: "same", mentions, view, observers: nextObservers });
      vi.advanceTimersByTime(25);
    };

    update(threadView);
    update({ ...threadView, layout: "compact" });
    expect(onDraftChange).toHaveBeenCalledTimes(1);

    update({ ...threadView, scope: { kind: "thread", threadId: "thr_2" } });
    expect(onDraftChange).toHaveBeenCalledTimes(2);

    update({ ...threadView, scope: { kind: "thread", threadId: "thr_2" } }, [
      ...observers,
    ]);
    expect(onDraftChange).toHaveBeenCalledTimes(3);
    runner.dispose();
  });

  it("keeps notifying other observers when one throws", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const healthy = vi.fn();
    const runner = createDraftObserverRunner(25);

    runner.update({
      text: "draft",
      mentions: [],
      view: threadView,
      observers: [
        observer(() => {
          throw new Error("broken observer");
        }, "broken"),
        observer(healthy, "healthy"),
      ],
    });
    vi.advanceTimersByTime(25);

    expect(healthy).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[composer-draft-observer:sample/broken] onDraftChange failed",
      expect.any(Error),
    );
    runner.dispose();
  });

  it("drops a pending notification on dispose", () => {
    vi.useFakeTimers();
    const onDraftChange = vi.fn();
    const runner = createDraftObserverRunner(25);
    runner.update({
      text: "draft",
      mentions: [],
      view: threadView,
      observers: [observer(onDraftChange)],
    });
    runner.dispose();
    vi.advanceTimersByTime(25);
    expect(onDraftChange).not.toHaveBeenCalled();
  });
});
