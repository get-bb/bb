import { useCallback, useState } from "react";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import {
  SplitButton,
  type SplitButtonAction,
} from "@/components/ui/split-button.js";
import { WorkspaceOpenTargetIcon } from "@/components/workspace-open-target/WorkspaceOpenTargetIcon";

interface ThreadWorkspaceOpenButtonProps {
  onOpenPreferredTarget: () => Promise<void>;
  onOpenTarget: (targetId: WorkspaceOpenTargetId) => Promise<void>;
  preferredTarget: WorkspaceOpenTarget | null;
  targets: WorkspaceOpenTarget[];
}

export function ThreadWorkspaceOpenButton({
  onOpenPreferredTarget,
  onOpenTarget,
  preferredTarget,
  targets,
}: ThreadWorkspaceOpenButtonProps) {
  const [pendingTargetId, setPendingTargetId] =
    useState<WorkspaceOpenTargetId | null>(null);
  const isPending = pendingTargetId !== null;

  const openTarget = useCallback(
    async (target: WorkspaceOpenTarget, action: () => Promise<void>) => {
      if (pendingTargetId !== null) {
        return;
      }

      setPendingTargetId(target.id);
      try {
        await action();
      } finally {
        setPendingTargetId(null);
      }
    },
    [pendingTargetId],
  );

  if (!preferredTarget) {
    return null;
  }

  const primaryAction: SplitButtonAction = {
    label: `Open workspace in ${preferredTarget.label}`,
    onSelect: () => {
      void openTarget(preferredTarget, onOpenPreferredTarget);
    },
    content: (
      <WorkspaceOpenTargetIcon
        target={preferredTarget}
        className="size-5"
      />
    ),
  };
  const secondaryActions: SplitButtonAction[] = targets.map((target) => ({
    label: target.label,
    onSelect: () => {
      void openTarget(target, () => onOpenTarget(target.id));
    },
    content: (
      <>
        <WorkspaceOpenTargetIcon target={target} className="size-5" />
        <span className="min-w-0 flex-1">{target.label}</span>
      </>
    ),
  }));

  return (
    <SplitButton
      disabled={isPending}
      className="px-1"
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
      triggerLabel="Choose workspace open target"
      mobileTitle="Open Workspace"
    />
  );
}
