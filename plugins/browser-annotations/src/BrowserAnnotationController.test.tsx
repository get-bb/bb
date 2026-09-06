// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalBrowserControllerLifecycle } from "@get-bb/plugin-sdk/app";
import { BrowserAnnotationController } from "./BrowserAnnotationController";
import {
  browserAnnotationSnapshot,
  createEmptyBrowserScreenshotEditor,
  resetBrowserAnnotationStore,
  setBrowserAnnotationScreenshot,
} from "./annotation-state";
import type {
  BrowserElementAnnotationCapture,
  BrowserElementAnnotationNote,
} from "./element-capture";
import { getAnnotationToolbarController } from "./annotation-toolbar-bridge";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  let composerScope: unknown = { kind: "thread", threadId: "thread-1" };
  let composerAddQuote = vi.fn();
  return {
    ...actual,
    __setComposerScope(scope: unknown, addQuote: typeof composerAddQuote) {
      composerScope = scope;
      composerAddQuote = addQuote;
    },
    useComposer: () => ({
      scope: composerScope,
      text: "",
      setText: vi.fn(),
      updateText: vi.fn(),
      clear: vi.fn(),
      setTextEffect: vi.fn(),
      setInputLock: vi.fn(),
      addQuote: composerAddQuote,
      insertMention: vi.fn(),
      focus: vi.fn(),
      experimental_submit: vi.fn(),
    }),
  };
});

async function mockComposerScope(
  scope: unknown,
  addQuote: ReturnType<typeof vi.fn>,
): Promise<void> {
  const mocked = (await import("@get-bb/plugin-sdk/app")) as unknown as {
    __setComposerScope: (
      scope: unknown,
      addQuote: ReturnType<typeof vi.fn>,
    ) => void;
  };
  mocked.__setComposerScope(scope, addQuote);
}

const target = {
  clientId: "client-1",
  windowId: "window-1",
  tabId: "tab-1",
  navigationEpoch: 7,
};

const captureDescriptor = {
  byteLength: 10,
  captureId: "capture-1",
  expiresAt: 1_788_000_120_000,
  mimeType: "image/png" as const,
  pixelSize: { height: 900, width: 1440 },
  target,
};

const capture: BrowserElementAnnotationCapture = {
  accessibility: {
    ariaLabel: null,
    ariaLabelledBy: null,
    description: null,
    name: "Purchase a subscription",
    role: "button",
  },
  ancestorPath: ["main", "body"],
  capturedAt: "2026-08-31T00:00:00.000Z",
  devicePixelRatio: 2,
  dom: {
    attributes: { role: "button" },
    classes: ["purchase"],
    id: "subscribe",
    selector: "button#subscribe",
    tag: "button",
  },
  editable: false,
  fullDomPath: "body > main > button#subscribe",
  html: '<button id="subscribe">Purchase a subscription</button>',
  nearbyElements: [],
  nearbyText: [],
  reactComponents: "<PurchaseButton>",
  rect: { height: 32, width: 180, x: 24, y: 48 },
  rectPage: { height: 32, width: 180, x: 24, y: 248 },
  scroll: { x: 0, y: 200 },
  selectedText: null,
  sourceFile: "/app/frontend/src/pricing.tsx:42:3",
  styles: {
    backgroundColor: "rgb(0, 0, 0)",
    border: "",
    borderRadius: "",
    color: "rgb(255, 255, 255)",
    display: "inline-flex",
    fontFamily: "",
    fontSize: "14px",
    fontWeight: "600",
    height: "",
    lineHeight: "",
    margin: "",
    opacity: "1",
    padding: "",
    position: "relative",
    textAlign: "",
    width: "",
    zIndex: "auto",
  },
  text: "Purchase a subscription",
  title: "Pricing",
  url: "https://example.test/pricing?checkout=secret#plans",
  viewport: { height: 900, width: 1440 },
};

function note(
  overrides: Partial<BrowserElementAnnotationNote> = {},
): BrowserElementAnnotationNote {
  return {
    annotation: redactedCapture(),
    comment: "Move the CTA above the fold.",
    createdAt: "2026-08-31T00:00:00.000Z",
    id: "note-1",
    pageId: "tab-1",
    intent: "fix",
    screenshot: null,
    priority: "important",
    ...overrides,
  };
}

import { redactBrowserElementAnnotation } from "./element-capture";

function redactedCapture() {
  return redactBrowserElementAnnotation(capture)!;
}

function createProps(
  overrides: Partial<Parameters<typeof BrowserAnnotationController>[0]> = {},
) {
  const lifecycleListeners = new Set<
    (event: ExperimentalBrowserControllerLifecycle) => void
  >();
  let handler:
    | ((request: {
        input: unknown;
        target: typeof target;
        signal: AbortSignal;
      }) => Promise<unknown>)
    | null = null;
  const setOverlayOpen = vi.fn();
  const props: Parameters<typeof BrowserAnnotationController>[0] = {
    target,
    environmentId: null,
    threadId: "thread-1",
    projectId: "project-1",
    url: "https://example.test/pricing",
    isVisible: true,
    experimental_browserControlAvailable: true,
    experimental_lifecycleSignal: new AbortController().signal,
    experimental_onLifecycle: (listener) => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
    experimental_registerRequestHandler: (nextHandler) => {
      handler = nextHandler as typeof handler;
      return () => {
        if (handler === nextHandler) handler = null;
      };
    },
    experimental_capturePage: async () => ({
      navigationEpoch: target.navigationEpoch,
      url: "data:image/png;base64,c2NyZWVuc2hvdA==",
      pixelSize: { height: 900, width: 1440 },
      dispose: vi.fn(),
    }),
    experimental_createImageResource: async () => captureDescriptor,
    experimental_runBrowserPageScript: async () => ({
      navigationEpoch: target.navigationEpoch,
      value: capture as never,
    }),
    experimental_setOverlayOpen: setOverlayOpen,
    experimental_overlayRoot: null,
    ...overrides,
  };
  return {
    props,
    setOverlayOpen,
    lifecycleListeners,
    getHandler: () => handler,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetBrowserAnnotationStore();
});

describe("BrowserAnnotationController request operations", () => {
  it("implements get on an empty record", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const result = (await host.getHandler()!({
      input: { operation: "get" },
      target,
      signal: new AbortController().signal,
    })) as { notes: unknown[]; screenshot: unknown; review: unknown };
    expect(result).toEqual({ notes: [], screenshot: null, review: null });
  });

  it("adds a note via annotate and reads it back through get", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    await host.getHandler()!({
      input: {
        operation: "annotate",
        element: { target: "point", x: 10, y: 20 },
        intent: "fix",
        feedback: "Move the CTA above the fold.",
      },
      target,
      signal: new AbortController().signal,
    });
    const snapshot = browserAnnotationSnapshot({
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    });
    expect(snapshot?.elements?.notes).toHaveLength(1);
    const stored = snapshot!.elements!.notes[0]!;
    expect(stored.comment).toBe("Move the CTA above the fold.");
    expect(stored.intent).toBe("fix");
    expect(stored.annotation.pageUrl).toBe("https://example.test/pricing");
    expect(stored.annotation.pageUrl).not.toContain("checkout=secret");
  });

  it("implements update-note, move-note, remove-note, and clear-notes", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await call({
      operation: "annotate",
      element: { target: "point", x: 0, y: 0 },
      intent: "question",
      feedback: "Why is this disabled?",
    });
    await call({
      operation: "annotate",
      element: { target: "point", x: 1, y: 1 },
      intent: "fix",
      feedback: "Fix the CTA.",
    });
    let snapshot = browserAnnotationSnapshot({
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    });
    const firstId = snapshot!.elements!.notes[0]!.id;
    await call({
      operation: "update-note",
      id: firstId,
      intent: "question",
      feedback: "Wait",
    });
    snapshot = browserAnnotationSnapshot({
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    });
    expect(snapshot?.elements?.notes).toHaveLength(2);
    expect(snapshot!.elements!.notes[0]!.comment).toBe("Wait");
    expect(snapshot!.elements!.notes[1]!.comment).toBe("Fix the CTA.");
    const secondId = snapshot!.elements!.notes[1]!.id;
    await call({
      operation: "move-note",
      id: secondId,
      direction: "up",
    });
    snapshot = browserAnnotationSnapshot({
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    });
    expect(snapshot!.elements!.notes[0]!.id).toBe(secondId);
    await call({ operation: "remove-note", id: secondId });
    snapshot = browserAnnotationSnapshot({
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    });
    expect(snapshot!.elements!.notes).toHaveLength(1);
    await call({ operation: "clear-notes" });
    expect(
      browserAnnotationSnapshot({
        environmentId: null,
        threadId: "thread-1",
        tabId: "tab-1",
      }),
    ).toBeNull();
  });

  it("implements screenshot, set-editor, undo, redo, and clear-drawing", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await call({ operation: "screenshot" });
    const key = {
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    };
    let snapshot = browserAnnotationSnapshot(key)!;
    expect(snapshot.screenshot).not.toBeNull();
    expect(snapshot.screenshot!.editor.shapes).toEqual([]);

    await call({ operation: "undo" });
    snapshot = browserAnnotationSnapshot(key)!;
    expect(snapshot.screenshot!.editor.past).toHaveLength(0);

    const editor = createEmptyBrowserScreenshotEditor(
      snapshot.screenshot!.editor.image,
    );
    editor.past = [[]];
    editor.shapes = [
      {
        color: "#ef4444",
        from: { x: 10, y: 10 },
        id: "rect-1",
        kind: "rect",
        to: { x: 50, y: 40 },
        width: 8,
      },
    ];
    await call({ operation: "set-editor", editor });
    snapshot = browserAnnotationSnapshot(key)!;
    expect(snapshot.screenshot!.editor.shapes).toHaveLength(1);

    await call({ operation: "undo" });
    snapshot = browserAnnotationSnapshot(key)!;
    expect(snapshot.screenshot!.editor.shapes).toEqual([]);
    expect(snapshot.screenshot!.editor.redo).toHaveLength(1);

    await call({ operation: "redo" });
    snapshot = browserAnnotationSnapshot(key)!;
    expect(snapshot.screenshot!.editor.shapes).toHaveLength(1);
    expect(snapshot.screenshot!.editor.redo).toHaveLength(0);

    await call({ operation: "clear-drawing" });
    snapshot = browserAnnotationSnapshot(key)!;
    expect(snapshot.screenshot!.editor.shapes).toEqual([]);
    expect(snapshot.screenshot!.editor.past).toHaveLength(2);
  });

  it("exports text notes in the batch format", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await call({
      operation: "annotate",
      element: { target: "point", x: 0, y: 0 },
      intent: "fix",
      feedback: "Move the CTA.",
    });
    const result = (await call({ operation: "export", format: "text" })) as {
      text: string;
    };
    expect(result.text).toContain("## Design Feedback: /pricing");
    expect(result.text).toContain("**Feedback:** Move the CTA.");
    expect(result.text).not.toContain("checkout=secret");
  });

  it("records add-to-chat through the composer quote API", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await call({
      operation: "annotate",
      element: { target: "point", x: 0, y: 0 },
      intent: "fix",
      feedback: "Move the CTA.",
    });
    const result = (await call({ operation: "add-to-chat" })) as {
      addedToChat: boolean;
    };
    expect(result.addedToChat).toBe(true);
  });

  it("exposes the toolbar controller with picker interaction state", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const toolbar = getAnnotationToolbarController("tab-1");
    expect(toolbar).not.toBeNull();
    expect(toolbar!.getInteractionState()).toEqual({
      pickerMode: null,
      reviewOpen: false,
      editorOpen: false,
      browserControlAvailable: true,
    });
  });

  it("rejects a malformed or oversized editor snapshot without changing the draft", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await call({ operation: "screenshot" });
    const key = {
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    };
    const before = browserAnnotationSnapshot(key)!.screenshot!.editor;
    await expect(
      call({ operation: "set-editor", editor: "not-an-editor" }),
    ).rejects.toThrow();
    await expect(
      call({
        operation: "set-editor",
        editor: {
          image: before.image,
          color: "#ef4444",
          fontSize: 18,
          past: [],
          redo: [],
          shapes: [{ color: "#ef4444", kind: "bogus" }],
          tool: "pen",
          width: 4,
        },
      }),
    ).rejects.toThrow();
    await expect(
      call({
        operation: "set-editor",
        editor: {
          image: before.image,
          color: "#ef4444",
          fontSize: 18,
          past: [],
          redo: [],
          shapes: [],
          tool: "pen",
          width: Number.NaN,
        },
      }),
    ).rejects.toThrow();
    await expect(
      call({
        operation: "set-editor",
        editor: { ...before, image: { ...before.image, id: "another-image" } },
      }),
    ).rejects.toThrow();
    const after = browserAnnotationSnapshot(key)!.screenshot!.editor;
    expect(after).toEqual(before);
  });

  it("rejects add-to-chat when the composer targets another thread", async () => {
    const addQuote = vi.fn();
    await mockComposerScope(
      {
        kind: "side-chat",
        projectId: "p1",
        parentThreadId: "thread-0",
        tabId: "t",
        childThreadId: null,
      },
      addQuote,
    );
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await call({
      operation: "annotate",
      element: { target: "point", x: 0, y: 0 },
      intent: "fix",
      feedback: "Move the CTA.",
    });
    await expect(call({ operation: "add-to-chat" })).rejects.toThrow(
      "composer is unavailable",
    );
    expect(addQuote).not.toHaveBeenCalled();
    await mockComposerScope({ kind: "thread", threadId: "thread-1" }, addQuote);
    const { rerender } = render(
      <BrowserAnnotationController {...host.props} />,
    );
    void rerender;
    const refreshed = createProps();
    render(<BrowserAnnotationController {...refreshed.props} />);
    const refreshedCall = (input: unknown) =>
      refreshed.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await refreshedCall({
      operation: "annotate",
      element: { target: "point", x: 0, y: 0 },
      intent: "fix",
      feedback: "Move the CTA.",
    });
    await expect(refreshedCall({ operation: "add-to-chat" })).resolves.toEqual({
      addedToChat: true,
    });
    expect(addQuote).toHaveBeenCalledTimes(1);
  });

  it("rejects an interactive pick while the native page is hidden", async () => {
    const host = createProps({ isVisible: false });
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    await expect(call({ operation: "pick", mode: "grab" })).rejects.toThrow(
      "requires a visible Browser page",
    );
  });

  it("does not lease the overlay while an interactive pick is active", async () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const call = (input: unknown) =>
      host.getHandler()!({
        input: input as never,
        target,
        signal: new AbortController().signal,
      });
    const controller = new AbortController();
    const picking = call({ operation: "pick", mode: "grab" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsAfterPickStart = host.setOverlayOpen.mock.calls.map(
      (callArgs) => callArgs[0],
    );
    controller.abort();
    await picking.catch(() => undefined);
    expect(callsAfterPickStart.every((open) => open === false)).toBe(true);
  });

  it("retains records when presentation detaches", async () => {
    const host = createProps();
    const view = render(<BrowserAnnotationController {...host.props} />);
    const key = {
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    };
    setBrowserAnnotationScreenshot(key, 7, {
      editor: createEmptyBrowserScreenshotEditor({
        id: "image",
        width: 1440,
        height: 900,
      }),
      screenshot: captureDescriptor,
      previewUrl: "data:image/png;base64,x",
    });
    expect(browserAnnotationSnapshot(key)).not.toBeNull();
    view.unmount();
    expect(browserAnnotationSnapshot(key)).not.toBeNull();
  });

  it("unregisters its contribution handler when presentation detaches", () => {
    const host = createProps();
    const view = render(<BrowserAnnotationController {...host.props} />);

    expect(host.getHandler()).not.toBeNull();
    view.unmount();
    expect(host.getHandler()).toBeNull();
  });

  it("clears records after the Browser tab closes", () => {
    const host = createProps();
    render(<BrowserAnnotationController {...host.props} />);
    const key = {
      environmentId: null,
      threadId: "thread-1",
      tabId: "tab-1",
    };
    setBrowserAnnotationScreenshot(key, 7, {
      editor: createEmptyBrowserScreenshotEditor({
        id: "image",
        width: 1440,
        height: 900,
      }),
      screenshot: captureDescriptor,
      previewUrl: "data:image/png;base64,x",
    });

    act(() => {
      for (const listener of host.lifecycleListeners) {
        listener({ kind: "disposed", reason: "tab-closed", target });
      }
    });

    expect(browserAnnotationSnapshot(key)).toBeNull();
  });
});
