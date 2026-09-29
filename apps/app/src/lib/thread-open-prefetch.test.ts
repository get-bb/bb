// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installThreadOpenIntentPrefetch,
  resolveThreadIdFromAnchor,
  THREAD_OPEN_HOVER_INTENT_MS,
} from "./thread-open-prefetch";

function mountRows(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <a data-testid="one" href="/projects/proj-1/threads/thr-1"><span data-testid="one-label">One</span></a>
    <a data-testid="two" href="/threads/thr-2">Two</a>
    <a data-testid="settings" href="/settings">Settings</a>
    <div data-testid="gap">gap</div>
  `;
  document.body.append(root);
  return root;
}

function byTestId(root: HTMLElement, testId: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (element === null) {
    throw new Error(`missing ${testId}`);
  }
  return element;
}

function pointer(
  type: "pointerdown" | "pointerout" | "pointerover",
  target: HTMLElement,
  relatedTarget: HTMLElement | null = null,
) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }));
}

describe("installThreadOpenIntentPrefetch", () => {
  let root: HTMLElement;
  let prefetch: ReturnType<typeof vi.fn<(threadId: string) => void>>;
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    root = mountRows();
    prefetch = vi.fn<(threadId: string) => void>();
    uninstall = installThreadOpenIntentPrefetch(root, { prefetch });
  });

  afterEach(() => {
    uninstall();
    root.remove();
    vi.useRealTimers();
  });

  it("ignores a hover that leaves before the intent delay", () => {
    pointer("pointerover", byTestId(root, "one"));
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS - 1);
    pointer("pointerout", byTestId(root, "one"), byTestId(root, "gap"));
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS);

    expect(prefetch).not.toHaveBeenCalled();
  });

  it("prefetches once after a hover dwells past the intent delay", () => {
    pointer("pointerover", byTestId(root, "one"));
    pointer("pointerout", byTestId(root, "one"), byTestId(root, "one-label"));
    pointer("pointerover", byTestId(root, "one-label"));
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS);

    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith("thr-1");
  });

  it("moves the pending hover to the next row", () => {
    pointer("pointerover", byTestId(root, "one"));
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS / 2);
    pointer("pointerout", byTestId(root, "one"), byTestId(root, "two"));
    pointer("pointerover", byTestId(root, "two"));
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS);

    expect(prefetch.mock.calls).toEqual([["thr-2"]]);
  });

  it("prefetches immediately on pointerdown and dedupes the tap's hover", () => {
    pointer("pointerover", byTestId(root, "two"));
    pointer("pointerdown", byTestId(root, "two"));

    expect(prefetch.mock.calls).toEqual([["thr-2"]]);
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS);
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("prefetches immediately on keyboard focus", () => {
    byTestId(root, "one").dispatchEvent(
      new FocusEvent("focusin", { bubbles: true }),
    );

    expect(prefetch.mock.calls).toEqual([["thr-1"]]);
  });

  it("ignores anchors that do not open a thread", () => {
    pointer("pointerover", byTestId(root, "settings"));
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS);
    pointer("pointerdown", byTestId(root, "settings"));
    pointer("pointerdown", byTestId(root, "gap"));

    expect(prefetch).not.toHaveBeenCalled();
  });

  it("stops listening after uninstall", () => {
    pointer("pointerover", byTestId(root, "one"));
    uninstall();
    vi.advanceTimersByTime(THREAD_OPEN_HOVER_INTENT_MS);
    pointer("pointerdown", byTestId(root, "two"));

    expect(prefetch).not.toHaveBeenCalled();
  });
});

describe("resolveThreadIdFromAnchor", () => {
  it("resolves project and projectless thread links on this origin only", () => {
    const anchor = document.createElement("a");
    const origin = "https://bb.test";

    anchor.setAttribute("href", "/projects/proj-1/threads/thr-1?tab=diff");
    expect(resolveThreadIdFromAnchor(anchor, origin)).toBe("thr-1");
    anchor.setAttribute("href", "https://bb.test/threads/thr-2");
    expect(resolveThreadIdFromAnchor(anchor, origin)).toBe("thr-2");
    anchor.setAttribute("href", "https://elsewhere.test/threads/thr-3");
    expect(resolveThreadIdFromAnchor(anchor, origin)).toBeNull();
    anchor.setAttribute("href", "/projects/proj-1");
    expect(resolveThreadIdFromAnchor(anchor, origin)).toBeNull();
  });
});
