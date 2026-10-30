import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorage } from "@bb/test-helpers";
import type { PluginUpdateJob } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import { reportPluginUpdateJobs } from "./PluginUpdateJobsHost";

const base = {
  id: "update-1",
  pluginId: "notes",
  displayName: "Notes",
  kind: "update",
} as const;

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createMemoryStorage());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const queryClient = new QueryClient();
  const seen = new Map<string, string>();
  return (jobs: PluginUpdateJob[]) =>
    reportPluginUpdateJobs({
      jobs,
      seen,
      queryClient,
      action: () => ({ label: "Details", onClick: () => {} }),
    });
}

it.each(["updated", "rolled-back"] as const)(
  "recovers a watched update after reload and reports %s once",
  (outcome) => {
    const loading = vi.spyOn(appToast, "loading").mockReturnValue("toast");
    const success = vi.spyOn(appToast, "success").mockReturnValue("toast");
    const error = vi.spyOn(appToast, "error").mockReturnValue("toast");
    mount()([{ ...base, state: "running", phase: "checking" }]);
    expect(loading).toHaveBeenCalledWith(
      "Updating plugin…",
      expect.objectContaining({ id: "plugin-update:update-1" }),
    );
    const completed: PluginUpdateJob = {
      ...base,
      state: "completed",
      result: {
        applied: outcome === "updated",
        from: { version: "1", label: "1", display: "1" },
        outcome,
      },
    };
    const publish = mount();
    publish([completed]);
    const toast = outcome === "updated" ? success : error;
    expect(toast).toHaveBeenCalledWith(
      outcome === "updated" ? "Plugin updated" : "Plugin update failed",
      expect.objectContaining({ id: "plugin-update:update-1" }),
    );
    publish([{ ...completed }]);
    mount()([completed]);
    expect(toast).toHaveBeenCalledOnce();
  },
);

it.each([
  {
    ending: "reverted",
    job: {
      state: "completed",
      result: {
        applied: true,
        from: { version: "1.1.0", label: "1.1.0", display: "1.1.0" },
        to: { version: "1.0.0", label: "1.0.0", display: "1.0.0" },
        outcome: "reverted",
      },
    },
    toast: "success",
    title: "Plugin rolled back",
    description: "Notes",
  },
  {
    ending: "rolled-back",
    job: {
      state: "completed",
      result: {
        applied: false,
        from: { version: "1.1.0", label: "1.1.0", display: "1.1.0" },
        to: { version: "1.0.0", label: "1.0.0", display: "1.0.0" },
        outcome: "rolled-back",
        detail:
          "rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: boom",
      },
    },
    toast: "error",
    title: "Plugin rollback failed",
    description:
      "Notes — rolling back to 1.0.0 failed, so bb restored 1.1.0 and the data it had before the rollback: boom",
  },
  {
    ending: "failed",
    job: { state: "failed", error: "no rollback point" },
    toast: "error",
    title: "Plugin rollback failed",
    description: "Notes — no rollback point",
  },
] as const)(
  "names a rollback in its toasts when it ends $ending",
  ({ job, toast, title, description }) => {
    const loading = vi.spyOn(appToast, "loading").mockReturnValue("toast");
    const success = vi.spyOn(appToast, "success").mockReturnValue("toast");
    const error = vi.spyOn(appToast, "error").mockReturnValue("toast");
    const rollback = { ...base, id: "rollback-1", kind: "rollback" } as const;
    const publish = mount();
    publish([{ ...rollback, state: "running", phase: "activating" }]);
    expect(loading).toHaveBeenCalledWith(
      "Rolling back plugin…",
      expect.objectContaining({ id: "plugin-update:rollback-1" }),
    );
    publish([{ ...rollback, ...job }]);
    expect(toast === "success" ? success : error).toHaveBeenCalledWith(
      title,
      expect.objectContaining({ id: "plugin-update:rollback-1", description }),
    );
  },
);
