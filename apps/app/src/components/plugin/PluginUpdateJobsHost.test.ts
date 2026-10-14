import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorage } from "@bb/test-helpers";
import type { PluginUpdateJob } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import { reportPluginUpdateJobs } from "./PluginUpdateJobsHost";

const base = { id: "update-1", pluginId: "notes", displayName: "Notes" };

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
        from: { version: "1", display: "1" },
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
