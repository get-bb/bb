import { useState } from "react";
import { useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import type { DelegationRpcContract } from "../../delegate/contract.js";
import type { Preset, TaskThread } from "../../shared/contract.js";
import {
  THREAD_STATUS_META,
  formatRelativeTime,
  isActiveThread,
} from "./meta.js";
import {
  PresetDialog,
  savePresetDraft,
} from "../manage/preset-dialog.js";
import { useTasksRpc } from "../../shell/data.js";
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

const LAST_PRESET_STORAGE_KEY = "bb-tasks:last-dispatch-preset";

function loadLastPresetId(): string | null {
  try {
    return window.localStorage.getItem(LAST_PRESET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLastPresetId(presetId: string): void {
  try {
    window.localStorage.setItem(LAST_PRESET_STORAGE_KEY, presetId);
  } catch {
    // Persistence is best-effort (e.g. sandboxed iframes without storage).
  }
}

export interface DispatchControlProps {
  taskId: string;
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  align?: "start" | "end";
  /** Hero CTA (properties rail) vs quiet outline (threads header). */
  appearance?: "primary" | "outline";
  /** "preset" drops the Zap icon and "Dispatch ·" prefix — the rail's
   *  Dispatch-target section already carries that meaning. */
  labelMode?: "dispatch" | "preset";
  className?: string;
}

/**
 * GitHub-merge-style split button around the dispatch RPC: the primary
 * segment dispatches immediately with the last-used preset (persisted in
 * localStorage; first preset alphabetically as the fallback), the chevron
 * segment opens the preset menu, which also updates the remembered choice.
 * With zero presets it collapses to an "Add a preset…" button opening the
 * preset dialog in create mode.
 */
export function DispatchControl({
  taskId,
  presets,
  onError,
  align = "end",
  appearance = "outline",
  labelMode = "dispatch",
  className,
}: DispatchControlProps) {
  const rpc = useRpc<DelegationRpcContract>();
  const tasksRpc = useTasksRpc();
  const [dispatching, setDispatching] = useState(false);
  const [readonlyConfirm, setReadonlyConfirm] = useState<Preset | null>(null);
  const [lastPresetId, setLastPresetId] = useState(loadLastPresetId);
  // Keyed remount resets the create dialog's draft per open.
  const [createDialogKey, setCreateDialogKey] = useState<number | null>(null);

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
    setLastPresetId(preset.id);
    storeLastPresetId(preset.id);
    if (preset.permissionMode === "readonly") setReadonlyConfirm(preset);
    else void dispatch(preset.id);
  };

  // bg-primary (not the default bg-foreground): custom palettes like Nord
  // define an accent primary the hero CTA should pick up; in the default
  // theme both read as intended.
  const primarySegment =
    appearance === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : undefined;
  const buttonVariant = appearance === "primary" ? "default" : "outline";

  if (presets !== undefined && presets.length === 0) {
    return (
      <>
        <Button
          size="sm"
          variant={buttonVariant}
          className={cn("h-7 gap-1.5", primarySegment, className)}
          onClick={() => setCreateDialogKey(Date.now())}
        >
          <Icon name="Plus" className="size-3.5 shrink-0" />
          Add a preset…
        </Button>
        {createDialogKey !== null ? (
          <PresetDialog
            key={createDialogKey}
            open
            onOpenChange={(open) => {
              if (!open) setCreateDialogKey(null);
            }}
            editing={null}
            onSave={(draft) => savePresetDraft(tasksRpc, null, draft)}
          />
        ) : null}
      </>
    );
  }

  const current =
    presets?.find((preset) => preset.id === lastPresetId) ??
    (presets
      ? [...presets].sort((a, b) => a.name.localeCompare(b.name))[0]
      : undefined);

  return (
    <>
      <div className={cn("flex min-w-0", className)}>
        <Button
          size="sm"
          variant={buttonVariant}
          disabled={dispatching || !current}
          className={cn(
            "h-7 min-w-0 flex-1 gap-1.5 rounded-r-none",
            primarySegment,
          )}
          onClick={() => {
            if (current) pickPreset(current);
          }}
        >
          {labelMode === "dispatch" ? (
            <Icon name="Zap" className="size-3.5 shrink-0" />
          ) : null}
          <span className="truncate">
            {dispatching
              ? "Dispatching…"
              : current
                ? labelMode === "preset"
                  ? current.name
                  : `Dispatch · ${current.name}`
                : "Dispatch"}
          </span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={dispatching || !current}>
            <Button
              size="sm"
              variant={buttonVariant}
              aria-label="Choose dispatch preset"
              className={cn(
                "h-7 shrink-0 rounded-l-none px-1",
                primarySegment,
                appearance === "primary"
                  ? "border-l border-primary-foreground/25"
                  : "-ml-px",
              )}
            >
              <Icon name="ChevronDown" className="size-3.5" />
            </Button>
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
                {preset.id === current?.id ? (
                  <Icon name="Check" className="size-3.5" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
        <DispatchControl
          taskId={taskId}
          presets={presets}
          onError={onError}
          appearance="outline"
          className="ml-auto"
        />
      </div>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
    </section>
  );
}
