// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import type { PromptDraftState } from "@bb/client-core";
import { PluginContext } from "@/components/plugin/plugin-context";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import {
  clearComposerEditorBridge,
  publishComposerEditorBridge,
  type ComposerEditorBridge,
} from "./composer-editor-registry";
import { useComposers } from "./plugin-sdk-hooks";

interface TestHost extends PluginComposerHost {
  draft(): PromptDraftState;
}

function createHost(key: string, scope: PluginComposerScope): TestHost {
  let draft: PromptDraftState = { text: "", mentions: [], attachments: [] };
  const listeners = new Set<() => void>();
  return {
    scope,
    textEffectKey: key,
    getCurrent: () => draft,
    subscribeDraft: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDraft: (next) => {
      draft = next;
      for (const listener of [...listeners]) listener();
    },
    focus: () => {},
    draft: () => draft,
  };
}

const published: Array<[string, ComposerEditorBridge]> = [];

function mountEditor(host: TestHost, pluginCustomizable = true) {
  const bridge: ComposerEditorBridge = {
    host,
    pluginCustomizable,
    state: {
      layout: "expanded",
      isRunning: false,
      isSubmitting: false,
      isSubmittingBlocked: true,
      submittingBlockedReason: "Type a message first.",
      isAttaching: false,
      attachmentError: null,
    },
    insertAtCursor: () => {},
  };
  act(() => publishComposerEditorBridge(host.textEffectKey, bridge));
  published.push([host.textEffectKey, bridge]);
  return () => act(() => clearComposerEditorBridge(host.textEffectKey, bridge));
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <PluginContext.Provider value="demo">{children}</PluginContext.Provider>
  );
}

afterEach(() => {
  for (const [key, bridge] of published.splice(0)) {
    clearComposerEditorBridge(key, bridge);
  }
  vi.restoreAllMocks();
});

describe("useComposers", () => {
  it("lists customizable composers oldest first and writes into the one picked", () => {
    const thread = createHost("thread-a", {
      kind: "thread",
      threadId: "thr_a",
    });
    const side = createHost("thread-b", { kind: "thread", threadId: "thr_b" });
    const sentEdit = createHost("sent-edit", {
      kind: "thread",
      threadId: "thr_a",
    });
    mountEditor(thread);
    const unmountSide = mountEditor(side);
    mountEditor(sentEdit, false);

    const { result } = renderHook(() => useComposers(), { wrapper });
    expect(result.current.map((composer) => composer.key)).toEqual([
      "thread-a",
      "thread-b",
    ]);
    const [, sideHandle] = result.current;

    act(() => {
      sideHandle!.insert("src/app.ts", { at: "end" });
    });
    expect(side.draft().text).toBe("src/app.ts");
    expect(thread.draft().text).toBe("");
    expect(result.current[1]).toBe(sideHandle);
    expect(result.current[1]!.text).toBe("src/app.ts");

    unmountSide();
    expect(result.current.map((composer) => composer.key)).toEqual([
      "thread-a",
    ]);
  });

  it("re-renders when a listed draft changes", () => {
    const thread = createHost("thread-a", {
      kind: "thread",
      threadId: "thr_a",
    });
    mountEditor(thread);
    const { result } = renderHook(() => useComposers()[0]?.isEmpty, {
      wrapper,
    });
    expect(result.current).toBe(true);

    act(() => {
      thread.setDraft({ text: "hello", mentions: [], attachments: [] });
    });
    expect(result.current).toBe(false);
  });

  it("does not let listed handles lock or paint a composer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const thread = createHost("thread-a", {
      kind: "thread",
      threadId: "thr_a",
    });
    mountEditor(thread);
    const { result } = renderHook(() => useComposers(), { wrapper });

    result.current[0]!.setInputLock(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("useComposers() composer.setInputLock"),
    );
  });
});
