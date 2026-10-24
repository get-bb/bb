import type { Thread } from "@bb/domain";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@bb/shared-ui/confirm-delete-dialog";
import { formatChildThreadCount } from "@/lib/child-thread-copy";

export interface ThreadDeleteDialogTarget {
  threads: readonly Thread[];
  childThreadCount?: number;
}

interface ThreadDeleteDialogProps<Target extends ThreadDeleteDialogTarget> {
  target: Target | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (target: Target) => void;
}

export function ThreadDeleteDialog<Target extends ThreadDeleteDialogTarget>({
  target,
  pending,
  onOpenChange,
  onDelete,
}: ThreadDeleteDialogProps<Target>) {
  return (
    <ConfirmDeleteDialog open={target !== null} onOpenChange={onOpenChange}>
      {target ? (
        <ThreadDeleteDialogContent
          target={target}
          pending={pending}
          onOpenChange={onOpenChange}
          onDelete={onDelete}
        />
      ) : null}
    </ConfirmDeleteDialog>
  );
}

interface ThreadDeleteDialogContentProps<
  Target extends ThreadDeleteDialogTarget,
> {
  target: Target;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (target: Target) => void;
}

export function ThreadDeleteDialogContent<
  Target extends ThreadDeleteDialogTarget,
>({
  target,
  pending,
  onOpenChange,
  onDelete,
}: ThreadDeleteDialogContentProps<Target>) {
  const single = target.threads.length === 1;
  const label = single ? "thread" : `${target.threads.length} threads`;

  return (
    <ConfirmDeleteDialogContent
      title={`Delete ${label}?`}
      description={
        <>
          {target.childThreadCount ? (
            <>
              {single ? "Its" : "Their"}{" "}
              <span className="font-semibold">
                {formatChildThreadCount(target.childThreadCount)}
              </span>{" "}
              will be deleted too.{" "}
            </>
          ) : null}
          This action cannot be undone.
        </>
      }
      confirmLabel={`Delete ${label}`}
      pending={pending}
      onConfirm={() => onDelete(target)}
      onCancel={() => onOpenChange(false)}
    />
  );
}
