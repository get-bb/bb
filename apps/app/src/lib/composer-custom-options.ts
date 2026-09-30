import {
  customOptionsByPluginSchema,
  snapshotCustomOptions,
  type CustomOptionsByPlugin,
} from "@bb/domain";
import type { PromptDraftState } from "@bb/client-core";
import type { ComposerHostSubmitOptions } from "@get-bb/plugin-sdk/internal/composer-handle";

export function captureComposerCustomOptions(
  draft: PromptDraftState,
  options?: ComposerHostSubmitOptions | null,
): CustomOptionsByPlugin {
  const snapshot = { ...draft.customOptionsByPlugin };
  const override = options?.customOptionsOverride;
  if (override)
    snapshot[override.pluginId] = snapshotCustomOptions(override.options);
  return customOptionsByPluginSchema.parse(snapshot);
}
