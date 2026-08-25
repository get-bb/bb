import type { ExperimentalChangesViewTargetState } from "@get-bb/plugin-sdk";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { ChangesView, type ChangesViewProps } from "./ChangesView";
import { useChangesViewReplacement } from "./changesViewProvider";

const CHANGES_VIEW_SLOT_KIND = "changesView";

interface ChangesViewHostProps extends Omit<
  ChangesViewProps,
  "experimental_target"
> {
  experimental_target: ExperimentalChangesViewTargetState | null;
  instanceId?: string;
  threadId?: string;
}

/** Resolves the exclusive whole-Changes replacement for one app pane. */
export function ChangesViewHost({
  environmentId,
  experimental_target,
  instanceId,
  threadId,
  ...ownerProps
}: ChangesViewHostProps) {
  const replacement = useChangesViewReplacement();
  const original = (
    <ChangesView
      {...ownerProps}
      environmentId={environmentId}
      experimental_target={experimental_target}
    />
  );

  if (
    environmentId === undefined ||
    instanceId === undefined ||
    threadId === undefined
  ) {
    return original;
  }

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={CHANGES_VIEW_SLOT_KIND}
      instanceId={instanceId}
    >
      {(slot, BoundOriginal) => (
        <slot.component
          threadId={threadId}
          environmentId={environmentId}
          experimental_target={experimental_target}
          experimental_Original={BoundOriginal}
        />
      )}
    </PluginReplacementSlot>
  );
}
