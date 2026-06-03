// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getThreadConversationCollapsedAtom,
  getThreadConversationCollapsedStorageKey,
  getThreadSecondaryPanelOpenAtom,
  getThreadSecondaryPanelOpenStorageKey,
} from "./threadSecondaryPanelAtoms";

const THREAD_A = "thr_a";
const THREAD_B = "thr_b";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("getThreadSecondaryPanelOpenAtom", () => {
  it("defaults to open=false and persists toggles to a per-thread key", () => {
    const store = createStore();
    const atomA = getThreadSecondaryPanelOpenAtom(THREAD_A);
    expect(store.get(atomA)).toBe(false);

    store.set(atomA, true);
    expect(store.get(atomA)).toBe(true);
    expect(
      window.localStorage.getItem(
        getThreadSecondaryPanelOpenStorageKey({ threadId: THREAD_A }),
      ),
    ).toBe("true");

    store.set(atomA, false);
    expect(store.get(atomA)).toBe(false);
    expect(
      window.localStorage.getItem(
        getThreadSecondaryPanelOpenStorageKey({ threadId: THREAD_A }),
      ),
    ).toBe("false");
  });

  it("keeps each thread's open state isolated", () => {
    const store = createStore();
    const atomA = getThreadSecondaryPanelOpenAtom(THREAD_A);
    const atomB = getThreadSecondaryPanelOpenAtom(THREAD_B);

    store.set(atomA, true);

    expect(store.get(atomA)).toBe(true);
    expect(store.get(atomB)).toBe(false);
    expect(
      window.localStorage.getItem(
        getThreadSecondaryPanelOpenStorageKey({ threadId: THREAD_B }),
      ),
    ).toBeNull();

    store.set(atomB, false);
    expect(store.get(atomA)).toBe(true);
  });

  it("returns a stable atom reference per thread id", () => {
    expect(getThreadSecondaryPanelOpenAtom(THREAD_A)).toBe(
      getThreadSecondaryPanelOpenAtom(THREAD_A),
    );
    expect(getThreadSecondaryPanelOpenAtom(THREAD_A)).not.toBe(
      getThreadSecondaryPanelOpenAtom(THREAD_B),
    );
  });

  it("falls back to a non-persisted disabled atom without a thread id", () => {
    const store = createStore();
    const disabled = getThreadSecondaryPanelOpenAtom(undefined);
    expect(getThreadSecondaryPanelOpenAtom(null)).toBe(disabled);
    expect(store.get(disabled)).toBe(false);

    store.set(disabled, true);
    expect(window.localStorage.length).toBe(0);
  });

  it("hydrates a thread's persisted open state when its atom initializes", async () => {
    const { getThreadSecondaryPanelOpenStorageKey: seedKey } = await import(
      "./threadSecondaryPanelAtoms"
    );
    window.localStorage.setItem(seedKey({ threadId: THREAD_A }), "true");
    vi.resetModules();
    const { getThreadSecondaryPanelOpenAtom: hydratedGetter } = await import(
      "./threadSecondaryPanelAtoms"
    );

    expect(createStore().get(hydratedGetter(THREAD_A))).toBe(true);
  });
});

describe("getThreadConversationCollapsedAtom", () => {
  it("defaults to collapsed=false and persists toggles to a per-thread key", () => {
    const store = createStore();
    const atomA = getThreadConversationCollapsedAtom(THREAD_A);
    expect(store.get(atomA)).toBe(false);

    store.set(atomA, true);
    expect(store.get(atomA)).toBe(true);
    expect(
      window.localStorage.getItem(
        getThreadConversationCollapsedStorageKey({ threadId: THREAD_A }),
      ),
    ).toBe("true");

    store.set(atomA, false);
    expect(store.get(atomA)).toBe(false);
    expect(
      window.localStorage.getItem(
        getThreadConversationCollapsedStorageKey({ threadId: THREAD_A }),
      ),
    ).toBe("false");
  });

  it("keeps each thread's collapse state isolated", () => {
    const store = createStore();
    const atomA = getThreadConversationCollapsedAtom(THREAD_A);
    const atomB = getThreadConversationCollapsedAtom(THREAD_B);

    store.set(atomA, true);

    // Collapsing thread A must not collapse thread B, and B's storage key
    // stays untouched.
    expect(store.get(atomA)).toBe(true);
    expect(store.get(atomB)).toBe(false);
    expect(
      window.localStorage.getItem(
        getThreadConversationCollapsedStorageKey({ threadId: THREAD_B }),
      ),
    ).toBeNull();

    // Clearing B is likewise a no-op for A.
    store.set(atomB, false);
    expect(store.get(atomA)).toBe(true);
  });

  it("returns a stable atom reference per thread id", () => {
    expect(getThreadConversationCollapsedAtom(THREAD_A)).toBe(
      getThreadConversationCollapsedAtom(THREAD_A),
    );
    expect(getThreadConversationCollapsedAtom(THREAD_A)).not.toBe(
      getThreadConversationCollapsedAtom(THREAD_B),
    );
  });

  it("falls back to a non-persisted disabled atom without a thread id", () => {
    const store = createStore();
    const disabled = getThreadConversationCollapsedAtom(undefined);
    expect(getThreadConversationCollapsedAtom(null)).toBe(disabled);
    expect(store.get(disabled)).toBe(false);

    store.set(disabled, true);
    expect(window.localStorage.length).toBe(0);
  });

  it("hydrates a thread's persisted preference when its atom initializes", async () => {
    // The atom reads storage when it is created (page load), so re-import the
    // module after seeding localStorage to exercise the parse path.
    const { getThreadConversationCollapsedStorageKey: seedKey } = await import(
      "./threadSecondaryPanelAtoms"
    );
    window.localStorage.setItem(seedKey({ threadId: THREAD_A }), "true");
    vi.resetModules();
    const { getThreadConversationCollapsedAtom: hydratedGetter } = await import(
      "./threadSecondaryPanelAtoms"
    );

    expect(createStore().get(hydratedGetter(THREAD_A))).toBe(true);
  });
});
