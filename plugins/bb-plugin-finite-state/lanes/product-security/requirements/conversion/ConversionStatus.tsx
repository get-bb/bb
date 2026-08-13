import { Icon } from "@bb/shared-ui/icon";

export type ConversionDisplayState = "preparing" | "running" | "validating" | "awaiting_human" | "reviewed" | "discarded" | "failed";

const LABEL: Record<ConversionDisplayState, string> = {
  preparing: "Preparing grounded bundle",
  running: "Agent writing local proposals",
  validating: "Running schema and resolution gates",
  awaiting_human: "Awaiting human diff review",
  reviewed: "Valid local proposal reviewed",
  discarded: "Proposal discarded",
  failed: "Conversion needs attention",
};

export function ConversionStatus({ state }: { state: ConversionDisplayState }): React.JSX.Element {
  const busy = state === "preparing" || state === "running" || state === "validating";
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-sm" role="status">
      <Icon aria-hidden="true" className={busy ? "size-4 animate-spin" : state === "failed" ? "size-4 text-destructive" : "size-4"} name={busy ? "Spinner" : state === "failed" ? "AlertTriangle" : state === "reviewed" ? "CircleCheck" : "CircleDashed"} />
      {LABEL[state]}
    </div>
  );
}
