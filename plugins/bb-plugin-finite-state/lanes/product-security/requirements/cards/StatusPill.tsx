import type { RequirementEvidenceState } from "./schema.js";

const STATUS: Record<
  RequirementEvidenceState,
  { label: string; className: string }
> = {
  verified: {
    label: "Verified by evidence",
    className: "border-success/40 text-success",
  },
  partial: {
    label: "Partial evidence",
    className: "border-warning/40 text-warning",
  },
  failed: {
    label: "Failed evidence",
    className: "border-destructive/40 text-destructive",
  },
  not_run: {
    label: "Not run",
    className: "border-border text-muted-foreground",
  },
};

export function StatusPill({ state }: { state: RequirementEvidenceState }): React.JSX.Element {
  const status = STATUS[state];
  return (
    <span
      aria-label={`Evidence status: ${status.label}`}
      className={`inline-flex items-center rounded-md border bg-background px-2.5 py-0.5 text-xs font-semibold ${status.className}`}
      data-evidence-state={state}
    >
      {status.label}
    </span>
  );
}
