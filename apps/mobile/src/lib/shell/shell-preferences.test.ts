import { describe, expect, it } from "vitest";
import {
  createShellPreferenceStore,
  isRememberablePath,
  parseWebViewShellEnabled,
  WEBVIEW_SHELL_ENABLED_STORAGE_KEY,
  type ShellPreferenceStorage,
} from "./shell-preferences";

function fakeStorage(): ShellPreferenceStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("parseWebViewShellEnabled", () => {
  it("is off unless the stored value says otherwise", () => {
    expect(parseWebViewShellEnabled(undefined)).toBe(false);
    expect(parseWebViewShellEnabled("false")).toBe(false);
    expect(parseWebViewShellEnabled("nonsense")).toBe(false);
    expect(parseWebViewShellEnabled("true")).toBe(true);
  });
});

describe("createShellPreferenceStore", () => {
  it("notifies subscribers when the switch changes", () => {
    const storage = fakeStorage();
    const store = createShellPreferenceStore(storage);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    expect(store.isEnabled()).toBe(false);
    store.setEnabled(true);
    expect(store.isEnabled()).toBe(true);
    expect(notifications).toBe(1);
    store.setEnabled(true);
    expect(notifications).toBe(1);
    unsubscribe();
    store.setEnabled(false);
    expect(notifications).toBe(1);
  });

  it("follows a wipe of the underlying storage", () => {
    // The e2e reset and "forget this device" clear the whole preferences
    // store behind this handle. A cached `true` would strand the app on a
    // shell it has no profile for.
    const storage = fakeStorage();
    const store = createShellPreferenceStore(storage);
    store.setEnabled(true);
    expect(store.isEnabled()).toBe(true);
    storage.map.clear();
    expect(store.isEnabled()).toBe(false);
  });

  it("remembers a per-profile path and refuses a hostile one", () => {
    const storage = fakeStorage();
    const store = createShellPreferenceStore(storage);
    store.setLastPath("p1", "/threads/thr_1?tab=diff");
    expect(store.getLastPath("p1")).toBe("/threads/thr_1?tab=diff");
    expect(store.getLastPath("p2")).toBeNull();
    // A protocol-relative path would send the next load to another origin.
    store.setLastPath("p3", "//evil.example.com/");
    expect(store.getLastPath("p3")).toBeNull();
    store.setLastPath("p4", "no-leading-slash");
    expect(store.getLastPath("p4")).toBeNull();
    store.setLastPath("p5", `/${"a".repeat(600)}`);
    expect(store.getLastPath("p5")).toBeNull();
  });

  it("keys the switch where the settings screen expects it", () => {
    expect(WEBVIEW_SHELL_ENABLED_STORAGE_KEY).toBe("bb.webviewShell.enabled");
    expect(isRememberablePath("/")).toBe(true);
  });
});
