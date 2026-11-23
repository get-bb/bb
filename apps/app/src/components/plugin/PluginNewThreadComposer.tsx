import { useContext, useState } from "react";
import type {
  NewThreadComposerProps as PluginComposerProps,
  NewThreadRequest,
} from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  NewThreadComposer,
  type NewThreadComposerSeed,
} from "@/components/promptbox/NewThreadComposer";
import { PluginContext } from "@/components/plugin/plugin-context";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { initialPromptSeedFromComposer } from "@/lib/plugin-composer-handle";
import type { InitialPromptSeed } from "@/components/promptbox/mentions/initial-prompt-draft";

function pluginInitialPromptSeed(
  initialPrompt: NonNullable<PluginComposerProps["initialPrompt"]>,
  pluginId: string | null,
): InitialPromptSeed | null {
  try {
    return initialPromptSeedFromComposer(initialPrompt, pluginId);
  } catch (error) {
    console.warn(
      `[plugin:${pluginId ?? "unknown"}] NewThreadComposer ignored its initialPrompt: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function PluginNewThreadComposer({
  defaultProjectId,
  defaultProviderId,
  defaultModel,
  defaultReasoningLevel,
  defaultServiceTier,
  defaultPermissionMode,
  defaultEnvironment,
  initialPrompt,
  placeholder,
  layout = "contained",
  focusRequest,
  className,
  draftKey,
  onSubmit,
}: PluginComposerProps) {
  const pluginId = useContext(PluginContext);
  const quickCreateProject = useQuickCreateProjectController();
  const [rememberedProjectId] = useRootComposeProjectId();
  const [pickedProjectId, setPickedProjectId] = useState<string>(
    defaultProjectId ?? rememberedProjectId,
  );
  const [seededDefaultProjectId, setSeededDefaultProjectId] =
    useState(defaultProjectId);
  if (seededDefaultProjectId !== defaultProjectId) {
    setSeededDefaultProjectId(defaultProjectId);
    setPickedProjectId(defaultProjectId ?? rememberedProjectId);
  }

  const initialPromptSeed =
    initialPrompt === undefined
      ? null
      : pluginInitialPromptSeed(initialPrompt, pluginId);
  const seed: NewThreadComposerSeed = {
    providerId: defaultProviderId,
    model: defaultModel,
    reasoningLevel: defaultReasoningLevel,
    serviceTier: defaultServiceTier,
    permissionMode: defaultPermissionMode,
    environment: defaultEnvironment,
    ...(initialPromptSeed !== null ? { initialPrompt: initialPromptSeed } : {}),
  };
  const composerKey = draftKey ?? pluginId ?? "default";
  const handleSubmit = async (request: NewThreadRequest) => {
    await onSubmit({
      ...request,
      executionInputSources: {
        ...request.executionInputSources,
        providerId: "explicit",
      },
    });
  };

  return (
    <NewThreadComposer
      projectId={pickedProjectId}
      onProjectChange={setPickedProjectId}
      draftStorage={{ kind: "plugin-new-thread", key: composerKey }}
      selectionScope="component-local"
      seed={seed}
      resetKey={defaultProjectId ?? null}
      focusRequest={focusRequest}
      onSubmit={handleSubmit}
    >
      {({ renderPromptBox }) => (
        <div
          className={cn(
            layout === "contained"
              ? "flex h-full min-h-0 flex-col justify-end"
              : "flex flex-col",
            className,
          )}
        >
          {renderPromptBox({
            placeholder,
            allowNoProject: true,
            createProject: {
              onCreate: () =>
                quickCreateProject.openCreateDialogThen(setPickedProjectId),
              disabled:
                !quickCreateProject.isAvailable ||
                quickCreateProject.isCreating,
              isCreating: quickCreateProject.isCreating,
            },
            mentionMenuPlacement: layout === "contained" ? "top" : "bottom",
          })}
        </div>
      )}
    </NewThreadComposer>
  );
}
