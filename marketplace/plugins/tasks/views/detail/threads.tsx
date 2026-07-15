import { useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import type { Preset, TaskThread } from "../../shared/contract.js";
import {
  THREAD_STATUS_META,
  formatRelativeTime,
  isActiveThread,
} from "./meta.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../../components/confirm-dialog.js";

function ThreadCard({ thread }: { thread: TaskThread }) {
  const navigate = useBbNavigate();
  const meta = THREAD_STATUS_META[thread.liveStatus];
  return (
    <div className="mb-2 flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 shadow-2xs">
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-xs font-medium",
          meta.textClassName,
        )}
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", meta.dotClassName)}
        />
        {meta.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{thread.title}</div>
        <div className="text-xs text-muted-foreground">
          {thread.presetName} · attached {formatRelativeTime(thread.attachedAt)}
        </div>
      </div>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 text-xs font-medium underline decoration-input underline-offset-2 hover:decoration-current"
        onClick={() => navigate.toThread(thread.threadId)}
      >
        Open thread
        <Icon name="ArrowUpRight" className="size-3" />
      </button>
    </div>
  );
}

export interface DispatchControlProps {
  taskId: string;
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  align?: "start" | "end";
  /** Render-prop trigger; receives whether a dispatch is in flight. */
  children: (dispatching: boolean) => ReactNode;
}

/**
 * Preset picker + readonly-preset confirm around the dispatch RPC. The
 * trigger button comes from the caller (threads section, properties rail).
 */
export function DispatchControl({
  taskId,
  presets,
  onError,
  align = "end",
  children,
}: DispatchControlProps) {
  const rpc = useRpc<DelegationRpcContract>();
  const [dispatching, setDispatching] = useState(false);
  const [readonlyConfirm, setReadonlyConfirm] = useState<Preset | null>(null);

  const dispatch = async (presetId: string) => {
    setDispatching(true);
    try {
      await rpc.call("delegate", { taskId, presetId });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setDispatching(false);
    }
  };

  const pickPreset = (preset: Preset) => {
    if (preset.permissionMode === "readonly") setReadonlyConfirm(preset);
    else void dispatch(preset.id);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          asChild
          disabled={
            dispatching || (presets !== undefined && presets.length === 0)
          }
        >
          {children(dispatching)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          <DropdownMenuLabel>Dispatch with preset</DropdownMenuLabel>
          {(presets ?? []).map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => pickPreset(preset)}
            >
              <span className="min-w-0 flex-1 truncate">{preset.name}</span>
              <span className="text-xs text-muted-foreground">
                {preset.modelId}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={readonlyConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setReadonlyConfirm(null);
        }}
        title={`Dispatch with “${readonlyConfirm?.name ?? ""}”?`}
        description="This preset is read-only: the agent can inspect the workspace but can't run bb tasks commands unattended, so it won't update this task on its own."
        confirmLabel="Dispatch anyway"
        onConfirm={() => {
          const preset = readonlyConfirm;
          if (preset) void dispatch(preset.id);
        }}
      />
    </>
  );
}

export interface ThreadsSectionProps {
  taskId: string;
  threads: TaskThread[];
  presets: Preset[] | undefined;
  onError: (message: string) => void;
}

/** Attached-thread list; the caller skips it entirely when there are none. */
export function ThreadsSection({
  taskId,
  threads,
  presets,
  onError,
}: ThreadsSectionProps) {
  const activeCount = threads.filter(isActiveThread).length;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2 pt-1.5 text-xs font-semibold text-muted-foreground">
        Agent threads
        {activeCount > 0 ? (
          <span className="font-normal">{activeCount} working now</span>
        ) : null}
        <DispatchControl taskId={taskId} presets={presets} onError={onError}>
          {() => (
            <Button variant="outline" size="sm" className="ml-auto h-7 gap-1.5">
              <Icon name="Zap" className="size-3.5" />
              Dispatch
            </Button>
          )}
        </DispatchControl>
      </div>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
    </section>
  );
}
