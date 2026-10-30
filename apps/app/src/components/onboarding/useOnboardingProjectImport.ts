import { useEffect, useRef, useState } from "react";
import { isPromptDraftEmpty } from "@bb/client-core";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { usePromptDraftController } from "@/hooks/usePromptDraftStorage";
import { useImportedProjectDefault } from "@/lib/root-compose-selection";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

export function useOnboardingProjectImport({
  entry,
  onContinue,
  onSettled,
}: {
  entry: OnboardingEntry;
  onContinue: () => void;
  onSettled: () => void;
}) {
  const createProject = useCreateProject();
  const setImportedProjectDefault = useImportedProjectDefault();
  const draft = usePromptDraftController({ kind: "new-thread" });
  const lifetimeRef = useRef<{ active: boolean; canSelect: boolean } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const lifetime = {
      active: true,
      canSelect:
        entry === "first_run" && isPromptDraftEmpty(draft.getCurrent()),
    };
    lifetimeRef.current = lifetime;
    const checkDraft = () => {
      if (!isPromptDraftEmpty(draft.getCurrent())) lifetime.canSelect = false;
    };
    checkDraft();
    const unsubscribe = draft.subscribe(checkDraft);
    return () => {
      lifetime.active = false;
      unsubscribe();
    };
  }, [draft, entry]);

  const importProjects = async (
    hostId: string,
    repos: readonly { name: string; path: string }[],
  ) => {
    const lifetime = lifetimeRef.current;
    if (importing || !lifetime?.active) return;
    setImporting(true);
    let lastImportedProjectId: string | null = null;
    let succeededCount = 0;
    const recordOutcome = (outcome: "started" | "succeeded" | "failed") =>
      recordTelemetryEvent({
        name: "onboarding_operation",
        properties: {
          entry,
          step: "projects",
          operation: "import",
          outcome,
          item_count: repos.length,
          succeeded_count: succeededCount,
        },
      });
    recordOutcome("started");
    try {
      for (const repo of repos) {
        if (!lifetime.active) return;
        const project = await createProject.mutateAsync({
          name: repo.name,
          source: { type: "local_path", hostId, path: repo.path },
        });
        lastImportedProjectId = project.id;
        succeededCount += 1;
      }
      recordOutcome("succeeded");
    } catch {
      recordOutcome("failed");
      return;
    } finally {
      if (lifetime.active) {
        if (lifetime.canSelect && lastImportedProjectId !== null) {
          setImportedProjectDefault(lastImportedProjectId);
        }
        setImporting(false);
        onSettled();
      }
    }
    if (lifetime.active) onContinue();
  };

  return { importing, importProjects };
}
