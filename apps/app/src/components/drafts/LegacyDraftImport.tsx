import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DraftContentInput, DraftOptions } from "@bb/server-contract";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import {
  usePromptBoxEnvironmentPreference,
  usePromptBoxMachinePreference,
  usePromptBoxModelPreference,
  usePromptBoxPermissionModePreference,
  usePromptBoxProviderPreference,
  usePromptBoxReasoningLevelPreference,
  usePromptBoxServiceTierPreference,
} from "@/hooks/thread-creation-options/persisted-selection-fields";
import { sanitizeStoredEnvironmentValue } from "@/hooks/useThreadCreationOptions";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import { appToast } from "@/components/ui/app-toast";
import { importLegacyNewThreadDraft } from "@/lib/drafts/legacy-import";

const IMPORT_TOAST_ID = "legacy-new-thread-draft-import";

export function LegacyDraftImport() {
  const [projectId] = useRootComposeProjectId();
  const { value: providerId } = usePromptBoxProviderPreference();
  const { value: model } = usePromptBoxModelPreference(providerId);
  const { value: reasoningLevel } =
    usePromptBoxReasoningLevelPreference(providerId);
  const { value: serviceTier } = usePromptBoxServiceTierPreference();
  const { value: permissionMode } = usePromptBoxPermissionModePreference();
  const { value: environmentValue } =
    usePromptBoxEnvironmentPreference(projectId);
  const { value: machineId } = usePromptBoxMachinePreference(projectId);
  const seed = useMemo((): Omit<DraftContentInput, "prompt"> => {
    const parsed = parseEnvironmentValue(
      sanitizeStoredEnvironmentValue(environmentValue),
    );
    const environment: DraftOptions["environment"] =
      parsed?.type === "provider"
        ? {
            type: "provider",
            environmentProviderId: parsed.environmentProviderId,
            machine:
              machineId === "" ? null : { type: "existing", hostId: machineId },
            inputs: null,
          }
        : parsed?.type === "reuse" && parsed.environmentId !== null
          ? { type: "reuse", environmentId: parsed.environmentId }
          : null;
    return {
      projectId,
      options: {
        providerId: providerId || null,
        model: model || null,
        reasoningLevel: reasoningLevel || null,
        serviceTier: serviceTier || null,
        permissionMode: permissionMode || null,
        environment,
      },
    };
  }, [
    environmentValue,
    machineId,
    model,
    permissionMode,
    projectId,
    providerId,
    reasoningLevel,
    serviceTier,
  ]);
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const running = useRef(false);
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      let newerLegacyValue = true;
      while (newerLegacyValue) {
        const result = await importLegacyNewThreadDraft(seedRef.current);
        if (result.error !== null) {
          appToast.error("Could not save your existing draft", {
            id: IMPORT_TOAST_ID,
            description: "Your original draft is still on this device.",
            duration: Infinity,
            action: {
              label: "Retry",
              onClick: () => {
                void run();
              },
            },
          });
          return;
        }
        newerLegacyValue = result.newerLegacyValue;
      }
      appToast.dismiss(IMPORT_TOAST_ID);
    } finally {
      running.current = false;
    }
  }, []);
  useEffect(() => {
    void run();
    const onStorage = (event: StorageEvent) => {
      if (event.key === "bb.promptbox.contents-draft-3") void run();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", run);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", run);
    };
  }, [run]);
  return null;
}
