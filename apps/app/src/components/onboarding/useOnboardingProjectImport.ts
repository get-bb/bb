import { useEffect, useRef, useState } from "react";
import { isPromptDraftEmpty } from "@bb/client-core";
import { useCreateProject } from "@/hooks/mutations/project-mutations";
import { usePromptDraftController } from "@/hooks/usePromptDraftStorage";
import { useImportedProjectDefault } from "@/lib/root-compose-selection";
import {
  recordTelemetryEvent,
  type OnboardingEntry,
} from "./onboarding-telemetry";

const IMPORT_CONCURRENCY = 4;

export function useOnboardingProjectImport({
  entry,
  onContinue,
  onSettled,
}: {
  entry: OnboardingEntry;
  onContinue: () => void;
  onSettled: () => void;
}) {
  const createProject = useCreateProject({ showErrorToast: false });
  const setImportedProjectDefault = useImportedProjectDefault();
  const draft = usePromptDraftController({ kind: "new-thread" });
  const lifetimeRef = useRef<{ active: boolean; canSelect: boolean } | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [failedPaths, setFailedPaths] = useState<readonly string[]>([]);

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
    setFailedPaths([]);
    const recordOutcome = (
      outcome: "started" | "succeeded" | "failed",
      succeededCount: number,
    ) =>
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
    recordOutcome("started", 0);
    const projectIds: (string | null)[] = repos.map(() => null);
    let nextIndex = 0;
    const importNext = async (): Promise<void> => {
      while (lifetime.active && nextIndex < repos.length) {
        const index = nextIndex;
        nextIndex += 1;
        const repo = repos[index];
        if (repo === undefined) return;
        try {
          const project = await createProject.mutateAsync({
            name: repo.name,
            source: { type: "local_path", hostId, path: repo.path },
          });
          projectIds[index] = project.id;
        } catch {
          projectIds[index] = null;
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(IMPORT_CONCURRENCY, repos.length) },
        importNext,
      ),
    );
    if (!lifetime.active) return;
    const importedIds = projectIds.filter((id) => id !== null);
    const failed = repos.filter((_, index) => projectIds[index] === null);
    recordOutcome(
      failed.length === 0 ? "succeeded" : "failed",
      importedIds.length,
    );
    const lastImportedProjectId = importedIds.at(-1);
    if (lifetime.canSelect && lastImportedProjectId !== undefined) {
      setImportedProjectDefault(lastImportedProjectId);
    }
    setImporting(false);
    setFailedPaths(failed.map((repo) => repo.path));
    onSettled();
    if (failed.length === 0) onContinue();
  };

  return { importing, failedPaths, importProjects };
}
