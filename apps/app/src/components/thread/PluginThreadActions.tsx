import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { appToast } from "@/components/ui/app-toast.js";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  runPluginThreadAction,
  usePluginContributions,
  type PluginThreadActionContribution,
  type PluginThreadActionToast,
} from "@/hooks/queries/plugin-contribution-queries";

function showActionToast(toast: PluginThreadActionToast): void {
  if (toast.kind === "success") {
    appToast.success(toast.message);
  } else if (toast.kind === "error") {
    appToast.error(toast.message);
  } else {
    appToast.message(toast.message);
  }
}

interface PluginThreadActionButtonsProps {
  actions: PluginThreadActionContribution[];
  /** `${pluginId}/${id}` of the in-flight action; disables all buttons. */
  pendingActionKey: string | null;
  onRun: (action: PluginThreadActionContribution) => void;
}

export function pluginThreadActionKey(
  action: Pick<PluginThreadActionContribution, "pluginId" | "id">,
): string {
  return `${action.pluginId}/${action.id}`;
}

/**
 * Presentational row of plugin-contributed thread action buttons (plugin
 * design §4.9). The container below wires the contributions query, the
 * confirm dialog, and the run mutation.
 */
export function PluginThreadActionButtons({
  actions,
  pendingActionKey,
  onRun,
}: PluginThreadActionButtonsProps) {
  return (
    <>
      {actions.map((action) => {
        const key = pluginThreadActionKey(action);
        const isPending = pendingActionKey === key;
        return (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
            disabled={pendingActionKey !== null}
            aria-busy={isPending}
            onClick={() => {
              onRun(action);
            }}
          >
            {isPending ? (
              <Icon name="Spinner" className="animate-spin" aria-hidden="true" />
            ) : (
              <PluginIcon pluginId={action.pluginId} icon={action.icon} />
            )}
            {action.title}
          </Button>
        );
      })}
    </>
  );
}

/**
 * Thread actions contributed by running plugins, rendered in the thread
 * header. Click → optional confirm dialog → POST /plugins/:id/actions/:actionId
 * with a pending state on the button; the returned toast (or the failure)
 * surfaces through the app toaster. Renders nothing while the `plugins`
 * experiment is off or no plugin contributes an action.
 */
export function PluginThreadActions({ threadId }: { threadId: string }) {
  const contributions = usePluginContributions();
  const [confirmTarget, setConfirmTarget] =
    useState<PluginThreadActionContribution | null>(null);
  const runAction = useMutation({
    mutationFn: (action: PluginThreadActionContribution) =>
      runPluginThreadAction({
        pluginId: action.pluginId,
        actionId: action.id,
        threadId,
      }),
    onSuccess: (toast) => {
      if (toast) showActionToast(toast);
    },
    onError: (error, action) => {
      appToast.error(`${action.title} failed`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const actions = contributions.data?.threadActions ?? [];
  if (actions.length === 0) return null;

  const pendingActionKey =
    runAction.isPending && runAction.variables !== undefined
      ? pluginThreadActionKey(runAction.variables)
      : null;

  const run = (action: PluginThreadActionContribution) => {
    if (action.confirm !== null) {
      setConfirmTarget(action);
      return;
    }
    runAction.mutate(action);
  };

  return (
    <>
      <PluginThreadActionButtons
        actions={actions}
        pendingActionKey={pendingActionKey}
        onRun={run}
      />
      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <DialogContent>
          {confirmTarget !== null ? (
            <>
              <DialogHeader>
                <DialogTitle>{confirmTarget.title}</DialogTitle>
                <DialogDescription>{confirmTarget.confirm}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setConfirmTarget(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    runAction.mutate(confirmTarget);
                    setConfirmTarget(null);
                  }}
                >
                  {confirmTarget.title}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
