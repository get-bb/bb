import { Icon } from "@bb/shared-ui/icon";

const ITEMS = [
  ["CircleCheck", "Verified"],
  ["CircleX", "Failed"],
  ["AlertCircle", "Error"],
  ["AlertTriangle", "Inconclusive"],
  ["Loading", "Running"],
  ["NewTab", "Skipped"],
  ["Clock", "Mapped, not run"],
  ["NewTab", "No check mapped"],
] as const;

export function Legend(): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-label="Verification evidence legend">
      {ITEMS.map(([icon, label]) => (
        <span className="inline-flex items-center gap-1.5" key={label}>
          <Icon aria-hidden="true" className={`size-3.5 ${label === "Running" ? "animate-spin" : ""}`} name={icon} />
          {label}
        </span>
      ))}
      <span className="ml-auto">Stale is a row overlay; the evidence state remains visible.</span>
    </div>
  );
}
