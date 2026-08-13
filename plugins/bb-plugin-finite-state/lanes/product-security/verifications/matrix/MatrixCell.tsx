import { Icon } from "@bb/shared-ui/icon";
import type { VerificationCell, MatrixCellState } from "./status.js";
import { CELL_STATE_LABELS } from "./status.js";

const STATE_PRESENTATION: Record<MatrixCellState, {
  icon: "CircleX" | "AlertCircle" | "AlertTriangle" | "Loading" | "Clock" | "CircleCheck" | "NewTab";
  className: string;
}> = {
  failed: { icon: "CircleX", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  error: { icon: "AlertCircle", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  inconclusive: { icon: "AlertTriangle", className: "border-warning/40 bg-warning/10 text-foreground" },
  running: { icon: "Loading", className: "border-primary/40 bg-primary/10 text-primary" },
  pending: { icon: "Clock", className: "border-border bg-muted text-muted-foreground" },
  verified: { icon: "CircleCheck", className: "border-success/40 bg-success/10 text-success" },
  skipped: { icon: "NewTab", className: "border-border bg-muted/50 text-muted-foreground" },
  mapped_not_run: { icon: "Clock", className: "border-border bg-background text-foreground" },
  unmapped: { icon: "NewTab", className: "border-dashed border-border bg-transparent text-muted-foreground" },
};

export interface MatrixCellProps {
  cell: VerificationCell;
  rowIndex: number;
  columnIndex: number;
  tabIndex: number;
  onActivate(): void;
  onFocus(): void;
  onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void;
  register(element: HTMLButtonElement | null): void;
}

export function MatrixCell({
  cell,
  rowIndex,
  columnIndex,
  tabIndex,
  onActivate,
  onFocus,
  onKeyDown,
  register,
}: MatrixCellProps): React.JSX.Element {
  const presentation = STATE_PRESENTATION[cell.state];
  const label = CELL_STATE_LABELS[cell.state];
  const checkDetail = cell.checkCount === 0
    ? "no checks"
    : `${cell.checkCount} ${cell.checkCount === 1 ? "check" : "checks"}, ${cell.requiredCount} required`;
  return (
    <button
      aria-colindex={columnIndex + 2}
      aria-label={`${cell.requirementId}, ${cell.tier}: ${label}; ${checkDetail}`}
      aria-rowindex={rowIndex + 2}
      className={`group flex h-14 min-w-28 items-center justify-between gap-2 rounded-md border px-3 text-left text-xs transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${presentation.className}`}
      data-cell-state={cell.state}
      data-matrix-cell={`${cell.requirementId}:${cell.tier}`}
      onClick={onActivate}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      ref={register}
      role="gridcell"
      tabIndex={tabIndex}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          aria-hidden="true"
          className={`size-4 shrink-0 ${cell.state === "running" ? "animate-spin" : ""} ${cell.state === "inconclusive" ? "text-warning" : ""}`}
          name={presentation.icon}
        />
        <span className="truncate font-medium">{label}</span>
      </span>
      {cell.checkCount > 1 ? (
        <span className="rounded-full border border-current/20 px-1.5 py-0.5 tabular-nums" aria-label={`${cell.checkCount} checks`}>
          {cell.checkCount}
        </span>
      ) : null}
    </button>
  );
}
