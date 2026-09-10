// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePromptBoxEnvironmentPreference,
  usePromptBoxModelPreference,
  usePromptBoxPermissionModePreference,
  usePromptBoxProviderPreference,
  usePromptBoxReasoningLevelPreference,
  usePromptBoxServiceTierPreference,
} from "./persisted-selection-fields";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPermissionModePreference() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => usePromptBoxPermissionModePreference(), { wrapper });
}

describe("usePromptBoxPermissionModePreference", () => {
  it("migrates a stored legacy workspace-write preference to accept-edits", () => {
    window.localStorage.setItem(
      "bb.promptbox.permission-mode",
      "workspace-write",
    );
    const { result } = renderPermissionModePreference();
    expect(result.current.value).toBe("accept-edits");
  });

  it("drops a stored legacy readonly preference instead of widening it", () => {
    window.localStorage.setItem("bb.promptbox.permission-mode", "readonly");
    const { result } = renderPermissionModePreference();
    expect(result.current.value).toBe("");
  });

  it("keeps a stored current preset", () => {
    window.localStorage.setItem("bb.promptbox.permission-mode", "auto");
    const { result } = renderPermissionModePreference();
    expect(result.current.value).toBe("auto");
  });
});

function renderSelections(projectId = "project-a") {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(
    ({ projectId }) => {
      const provider = usePromptBoxProviderPreference();
      return {
        provider,
        model: usePromptBoxModelPreference(provider.value),
        reasoning: usePromptBoxReasoningLevelPreference(provider.value),
        serviceTier: usePromptBoxServiceTierPreference(),
        permission: usePromptBoxPermissionModePreference(),
        environment: usePromptBoxEnvironmentPreference(projectId),
      };
    },
    { wrapper, initialProps: { projectId } },
  );
}

const selections = [
  {
    field: "provider",
    key: "bb.promptbox.provider",
    initial: "codex",
    remote: "claude-code",
  },
  {
    field: "model",
    key: "bb.promptbox.model-codex-1",
    initial: "model-a",
    remote: "model-b",
  },
  {
    field: "reasoning",
    key: "bb.promptbox.reasoning-codex-1",
    initial: "high",
    remote: "low",
  },
  {
    field: "serviceTier",
    key: "bb.promptbox.service-tier",
    initial: "fast",
    remote: "default",
  },
  {
    field: "permission",
    key: "bb.promptbox.permission-mode",
    initial: "auto",
    remote: "accept-edits",
  },
  {
    field: "environment",
    key: "bb.promptbox.environment-project-a-1",
    initial: "provider:project-checkout",
    remote: "provider:git-worktree",
  },
] as const;

function seedSelections() {
  for (const { key, initial } of selections) {
    window.localStorage.setItem(key, initial);
  }
}

describe("tab-local composer selections", () => {
  it.each(selections)(
    "ignores another tab changing $field and preserves the inherited value on reload",
    ({ field, key, initial, remote }) => {
      seedSelections();
      const first = renderSelections();
      expect(first.result.current[field].value).toBe(initial);
      act(() => {
        window.localStorage.setItem(key, remote);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            oldValue: initial,
            newValue: remote,
            storageArea: window.localStorage,
          }),
        );
      });
      expect(first.result.current[field].value).toBe(initial);
      first.unmount();
      const reloaded = renderSelections();
      expect(reloaded.result.current[field].value).toBe(initial);
      expect(window.sessionStorage.getItem(key)).toBe(initial);
      expect(window.localStorage.getItem(key)).toBe(remote);
      reloaded.unmount();
      window.sessionStorage.clear();
      const newTab = renderSelections();
      expect(newTab.result.current[field].value).toBe(remote);
    },
  );

  it("keeps provider and project memories when switching away and back after remote changes", () => {
    seedSelections();
    const { result, rerender } = renderSelections();
    act(() => {
      result.current.provider.setValue("claude-code");
    });
    act(() => {
      result.current.model.setValue("claude-model");
      result.current.reasoning.setValue("medium");
    });
    rerender({ projectId: "project-b" });
    act(() => {
      result.current.environment.setValue("provider:git-worktree");
      window.localStorage.setItem("bb.promptbox.model-codex-1", "remote-model");
      window.localStorage.setItem("bb.promptbox.reasoning-codex-1", "low");
      window.localStorage.setItem(
        "bb.promptbox.environment-project-a-1",
        "provider:git-worktree",
      );
      result.current.provider.setValue("codex");
    });
    rerender({ projectId: "project-a" });
    expect(result.current.model.value).toBe("model-a");
    expect(result.current.reasoning.value).toBe("high");
    expect(result.current.environment.value).toBe("provider:project-checkout");
    act(() => result.current.provider.setValue("claude-code"));
    rerender({ projectId: "project-b" });
    expect(result.current.model.value).toBe("claude-model");
    expect(result.current.reasoning.value).toBe("medium");
    expect(result.current.environment.value).toBe("provider:git-worktree");
  });

  it("pins legacy provider model and reasoning before another tab changes the legacy owner", () => {
    window.localStorage.setItem("bb.promptbox.provider", "codex");
    window.localStorage.setItem("bb.promptbox.model", "legacy-model");
    window.localStorage.setItem("bb.promptbox.reasoning", "high");
    const first = renderSelections();
    expect(first.result.current.model.value).toBe("legacy-model");
    expect(first.result.current.reasoning.value).toBe("high");
    first.unmount();
    window.localStorage.setItem("bb.promptbox.provider", "claude-code");
    window.localStorage.removeItem("bb.promptbox.model");
    window.localStorage.removeItem("bb.promptbox.reasoning");
    const reloaded = renderSelections();
    expect(reloaded.result.current.provider.value).toBe("codex");
    expect(reloaded.result.current.model.value).toBe("legacy-model");
    expect(reloaded.result.current.reasoning.value).toBe("high");
  });
});
