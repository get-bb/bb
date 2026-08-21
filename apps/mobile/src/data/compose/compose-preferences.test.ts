import { describe, expect, it } from "vitest";
import {
  createComposePreferencesStore,
  parseStoredEnvironment,
  parseStoredPermissionMode,
  selectionToStoredEnvironment,
  storedEnvironmentToSelection,
  type ComposePreferencesStorage,
} from "./compose-preferences";

function memoryStorage(
  seed: Record<string, string> = {},
): ComposePreferencesStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe("createComposePreferencesStore", () => {
  it("reads the web app's stored spellings and defaults navigate-after-create to true", () => {
    const store = createComposePreferencesStore(
      memoryStorage({
        "bb.promptbox.provider": "codex",
        "bb.promptbox.service-tier": "fast",
        "bb.promptbox.permission-mode": "workspace-write",
        "bb.root-compose.project-id": "proj_1",
        "bb.promptbox.model-codex-1": "gpt-5",
        "bb.promptbox.reasoning-codex-1": "high",
        "bb.promptbox.environment-proj_1-1": "host:host_1:worktree",
      }),
    );
    expect(store.getSnapshot()).toMatchObject({
      providerId: "codex",
      serviceTier: "fast",
      permissionMode: "accept-edits",
      navigateAfterCreate: true,
      lastProjectId: "proj_1",
    });
    expect(store.getProviderSelection("codex")).toEqual({
      model: "gpt-5",
      reasoningLevel: "high",
    });
    expect(store.getProviderSelection("claude")).toEqual({
      model: "",
      reasoningLevel: "",
    });
    expect(store.getProjectEnvironment("proj_1")).toEqual({
      hostId: "host_1",
      mode: "worktree",
    });
    expect(store.getProjectEnvironment("proj_2")).toBeNull();
  });

  it("drops unknown stored values instead of guessing", () => {
    const store = createComposePreferencesStore(
      memoryStorage({
        "bb.promptbox.service-tier": "turbo",
        "bb.promptbox.permission-mode": "readonly",
        "bb.promptbox.reasoning-codex-1": "bogus",
        "bb.promptbox.environment-proj_1-1": "reuse:env_1",
        "bb.root-compose.navigate-after-create": "false",
      }),
    );
    expect(store.getSnapshot()).toMatchObject({
      serviceTier: "",
      permissionMode: "",
      navigateAfterCreate: false,
    });
    expect(store.getProviderSelection("codex").reasoningLevel).toBe("");
    expect(store.getProjectEnvironment("proj_1")).toBeNull();
    expect(parseStoredPermissionMode("readonly")).toBe("");
    expect(parseStoredEnvironment("host:h1:bogus")).toBeNull();
  });

  it("writes provider-scoped and project-scoped keys, bumps the revision, and notifies subscribers", () => {
    const storage = memoryStorage();
    const store = createComposePreferencesStore(storage);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    const before = store.getSnapshot();
    store.setProviderSelection("codex", {
      model: "gpt-5",
      reasoningLevel: "high",
    });
    store.setProjectEnvironment("proj_1", { hostId: "host_1", mode: "local" });
    store.setPermissionMode("auto");
    store.setNavigateAfterCreate(false);
    expect(storage.dump()).toEqual({
      "bb.promptbox.model-codex-1": "gpt-5",
      "bb.promptbox.reasoning-codex-1": "high",
      "bb.promptbox.environment-proj_1-1": "host:host_1:local",
      "bb.promptbox.permission-mode": "auto",
      "bb.root-compose.navigate-after-create": "false",
    });
    expect(store.getSnapshot().revision).toBeGreaterThan(before.revision);
    expect(notified).toBe(4);
    // Empty values remove the key (no preference), matching the web "".
    store.setProjectEnvironment("proj_1", null);
    store.setProviderSelection("codex", { model: "" });
    expect(storage.dump()["bb.promptbox.environment-proj_1-1"]).toBeUndefined();
    expect(storage.dump()["bb.promptbox.model-codex-1"]).toBeUndefined();
    unsubscribe();
    store.setServiceTier("fast");
    expect(notified).toBe(6);
  });

  it("round-trips host selections and never persists reuse or branch picks", () => {
    expect(
      selectionToStoredEnvironment({
        type: "host",
        hostId: "h1",
        workspace: { type: "managed-worktree", baseBranch: "feature/x" },
      }),
    ).toEqual({ hostId: "h1", mode: "worktree" });
    expect(
      selectionToStoredEnvironment({
        type: "host",
        hostId: "h1",
        workspace: {
          type: "unmanaged",
          path: "/tmp/repo",
          branch: { name: "main", isNew: false },
        },
      }),
    ).toEqual({ hostId: "h1", mode: "local" });
    expect(
      selectionToStoredEnvironment({ type: "reuse", environmentId: "env_1" }),
    ).toBeNull();
    expect(
      selectionToStoredEnvironment({ type: "project-default" }),
    ).toBeNull();
    expect(
      storedEnvironmentToSelection({ hostId: "h1", mode: "worktree" }),
    ).toEqual({
      type: "host",
      hostId: "h1",
      workspace: { type: "managed-worktree", baseBranch: null },
    });
    expect(
      storedEnvironmentToSelection({ hostId: "h1", mode: "local" }),
    ).toEqual({
      type: "host",
      hostId: "h1",
      workspace: { type: "unmanaged", path: null, branch: null },
    });
  });
});
