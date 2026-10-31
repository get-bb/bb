import { Fragment } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { durationToCompactString } from "@bb/thread-view";

export interface ProvisioningStep {
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly failed?: boolean;
  readonly output?: readonly { readonly atMs: number; readonly text: string }[];
}

export interface ProvisioningRun {
  readonly steps: readonly ProvisioningStep[];
  readonly usualMs: number;
  readonly slowMs: number;
  readonly error?: string;
}

type Status = "running" | "completed" | "failed";

interface StepAt {
  readonly label: string;
  readonly status: Status;
  readonly durationMs: number;
  readonly note: string | null;
}

interface RunAt {
  readonly status: Status;
  readonly elapsedMs: number;
  readonly remainingMs: number | null;
  readonly slow: boolean;
  readonly steps: readonly StepAt[];
}

export function runAt(run: ProvisioningRun, nowMs: number): RunAt {
  const failedStep = run.steps.find((step) => step.failed);
  const endMs = failedStep
    ? failedStep.endMs
    : Math.max(...run.steps.map((step) => step.endMs));
  const status: Status =
    nowMs < endMs ? "running" : failedStep ? "failed" : "completed";
  const elapsedMs = Math.min(nowMs, endMs);
  const steps = run.steps
    .filter(
      (step) =>
        step.startMs <= elapsedMs &&
        (!failedStep || step.startMs <= failedStep.startMs),
    )
    .map((step): StepAt => {
      const done = step.endMs <= elapsedMs;
      const stepStatus: Status = !done
        ? "running"
        : step.failed
          ? "failed"
          : "completed";
      const output = (step.output ?? []).filter(
        (line) => step.startMs + line.atMs <= elapsedMs,
      );
      return {
        label: step.label,
        status: stepStatus,
        durationMs: Math.min(elapsedMs, step.endMs) - step.startMs,
        note:
          stepStatus === "failed"
            ? (run.error ?? null)
            : stepStatus === "running"
              ? (output[output.length - 1]?.text ?? null)
              : null,
      };
    });
  return {
    status,
    elapsedMs,
    remainingMs:
      status === "running" && elapsedMs < run.usualMs
        ? run.usualMs - elapsedMs
        : null,
    slow: status === "running" && elapsedMs > run.slowMs,
    steps,
  };
}

const STEP_TONE: Record<Status, string> = {
  running: "text-foreground",
  completed: "text-foreground/70",
  failed: "text-destructive-text",
};

const TITLE: Record<Status, string> = {
  running: "Provisioning thread…",
  completed: "Provisioned thread",
  failed: "Provisioning thread failed",
};

export function ProvisioningRow({
  run,
  nowMs,
  expanded,
}: {
  run: ProvisioningRun;
  nowMs: number;
  expanded: boolean;
}) {
  const view = runAt(run, nowMs);
  const dimmed = view.status === "completed" && !expanded;
  return (
    <div className={cn("w-full", dimmed && "opacity-40")}>
      <div className="flex items-center gap-1 px-2 py-0.5 text-sm text-muted-foreground">
        <Icon
          name={view.status === "failed" ? "AlertCircle" : "Terminal"}
          className={cn(
            "mr-1 size-3.5 shrink-0",
            view.status === "failed" && "text-destructive-text",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "shrink-0",
            view.status === "running" && "animate-shine",
          )}
        >
          {TITLE[view.status]}
        </span>
        <span className="shrink-0 tabular-nums">
          {durationToCompactString(view.elapsedMs)}
        </span>
        {view.remainingMs !== null ? (
          <span className="shrink-0 tabular-nums text-subtle-foreground">
            · ~{durationToCompactString(view.remainingMs)} left
          </span>
        ) : null}
        {view.slow ? (
          <span className="shrink-0 text-warning-text">
            · slower than usual
          </span>
        ) : null}
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          className="size-3.5 shrink-0"
          aria-hidden
        />
      </div>
      {expanded ? (
        <div className="mx-2 mt-1.5 overflow-hidden rounded-lg border border-border bg-card px-4 py-3 font-mono text-xs leading-tight">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-8 gap-y-1">
            {view.steps.map((step) => (
              <Fragment key={step.label}>
                <span
                  className={cn(
                    "truncate",
                    STEP_TONE[step.status],
                    step.status === "running" && "animate-shine",
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "text-right tabular-nums",
                    STEP_TONE[step.status],
                  )}
                >
                  {durationToCompactString(step.durationMs)}
                </span>
                {step.note ? (
                  <span
                    className={cn(
                      "col-span-2 truncate pl-4",
                      step.status === "failed"
                        ? "text-destructive-text"
                        : "text-foreground/45",
                    )}
                  >
                    {step.note}
                  </span>
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function composerPlaceholder(
  run: ProvisioningRun,
  nowMs: number,
): string {
  const view = runAt(run, nowMs);
  return view.remainingMs === null
    ? "Setting up workspace..."
    : `Setting up workspace... ~${durationToCompactString(view.remainingMs)}`;
}
