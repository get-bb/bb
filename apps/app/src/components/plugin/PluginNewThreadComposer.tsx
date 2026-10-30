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

export function PluginNewThreadComposer({
  defaultProjectId,
  allowProjectChange = true,
  defaultProviderId,
  defaultModel,
  defaultReasoningLevel,
  defaultServiceTier,
  defaultPermissionMode,
  defaultSessionOptions,
  defaultEnvironment,
  allowProjectDefaultEnvironment = false,
  initialPrompt,
  placeholder,
  layout = "contained",
  focusRequest,
  className,
  draftKey,
  persistDraft = true,
  allowAttachments = true,
  allowPluginCustomizations = true,
  onSubmit,
}: PluginComposerProps) {
  const pluginId = useContext(PluginContext);
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(
    defaultProjectId ?? null,
  );
  const [seededDefaultProjectId, setSeededDefaultProjectId] =
    useState(defaultProjectId);
  if (seededDefaultProjectId !== defaultProjectId) {
    setSeededDefaultProjectId(defaultProjectId);
    setPickedProjectId(defaultProjectId ?? null);
  }

  const seed: NewThreadComposerSeed = {
    providerId: defaultProviderId,
    model: defaultModel,
    reasoningLevel: defaultReasoningLevel,
    serviceTier: defaultServiceTier,
    permissionMode: defaultPermissionMode,
    sessionOptions: defaultSessionOptions,
    environment: defaultEnvironment,
    initialPrompt,
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
      persistDraft={persistDraft}
      selectionScope="component-local"
      allowProjectDefaultEnvironment={allowProjectDefaultEnvironment}
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
            allowAttachments,
            suppressPluginComposerCustomizations: !allowPluginCustomizations,
            locks: { project: !allowProjectChange },
            mentionMenuPlacement: layout === "contained" ? "top" : "bottom",
          })}
        </div>
      )}
    </NewThreadComposer>
  );
}
