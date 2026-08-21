// @vitest-environment jsdom

import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  FILE_OPEN_TARGET_STORAGE_KEY,
  WORKSPACE_OPEN_TARGET_STORAGE_KEY,
  fileOpenTargetPreferenceAtom,
  useFileOpenTargetPreference,
  useWorkspaceOpenTargetPreference,
  workspaceOpenTargetPreferenceAtom,
} from "./workspace-open-target-preference";

const targets: WorkspaceOpenTarget[] = [
  {
    capabilities: {
      openDirectory: true,
      openFile: true,
      openFileAtLine: true,
    },
    id: "devin-desktop",
    kind: "editor",
    label: "Devin Desktop",
  },
  {
    capabilities: {
      openDirectory: true,
      openFile: true,
      openFileAtLine: false,
    },
    id: "default-app",
    kind: "default-app",
    label: "Default App",
  },
];

afterEach(() => {
  window.localStorage.clear();
});

describe("workspace open target preference override", () => {
  it("persists Default App over unknown directory and file target ids", async () => {
    const store = createStore();
    store.set(workspaceOpenTargetPreferenceAtom, "removed-editor");
    store.set(fileOpenTargetPreferenceAtom, "removed-editor");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    renderHook(
      () => {
        useWorkspaceOpenTargetPreference(targets);
        useFileOpenTargetPreference(targets);
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(store.get(workspaceOpenTargetPreferenceAtom)).toBe("default-app");
      expect(store.get(fileOpenTargetPreferenceAtom)).toBe("default-app");
    });
    expect(window.localStorage.getItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "default-app",
    );
    expect(window.localStorage.getItem(FILE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "default-app",
    );
  });

  it("migrates Windsurf preferences to Devin Desktop", async () => {
    const store = createStore();
    store.set(workspaceOpenTargetPreferenceAtom, "windsurf");
    store.set(fileOpenTargetPreferenceAtom, "windsurf");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    renderHook(
      () => {
        useWorkspaceOpenTargetPreference(targets);
        useFileOpenTargetPreference(targets);
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(store.get(workspaceOpenTargetPreferenceAtom)).toBe(
        "devin-desktop",
      );
      expect(store.get(fileOpenTargetPreferenceAtom)).toBe("devin-desktop");
    });
  });

  it("does not override preferences before available targets load", () => {
    const store = createStore();
    store.set(workspaceOpenTargetPreferenceAtom, "windsurf");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    renderHook(() => useWorkspaceOpenTargetPreference([]), { wrapper });

    expect(store.get(workspaceOpenTargetPreferenceAtom)).toBe("windsurf");
  });
});
