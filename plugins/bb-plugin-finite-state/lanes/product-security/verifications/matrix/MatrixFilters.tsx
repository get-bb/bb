import { Input } from "@bb/shared-ui/input";
import type { MatrixCellState, VerificationTier } from "./status.js";
import { CELL_STATE_LABELS, TIER_LABELS, VERIFICATION_TIERS } from "./status.js";

export interface MatrixFilterValue {
  text: string;
  tier: VerificationTier | "all";
  status: MatrixCellState | "all";
  unprovenOnly: boolean;
  showManual: boolean;
}

const FILTER_STATES: readonly MatrixCellState[] = [
  "failed", "error", "inconclusive", "running", "pending", "verified",
  "skipped", "mapped_not_run", "unmapped",
];

export function MatrixFilters({
  value,
  onChange,
  onRefresh,
}: {
  value: MatrixFilterValue;
  onChange(next: MatrixFilterValue): void;
  onRefresh(): void;
}): React.JSX.Element {
  const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-3 py-2" aria-label="Verification matrix filters">
      <Input
        aria-label="Filter requirements"
        className="min-w-52 max-w-sm flex-1"
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        placeholder="Filter requirement ID or EARS text…"
        value={value.text}
      />
      <select
        aria-label="Filter by verification tier"
        className={selectClass}
        onChange={(event) => {
          const nextTier = VERIFICATION_TIERS.find((tier) => tier === event.target.value) ?? "all";
          onChange({ ...value, tier: nextTier });
        }}
        value={value.tier}
      >
        <option value="all">All tiers</option>
        {VERIFICATION_TIERS.map((tier) => <option key={tier} value={tier}>{TIER_LABELS[tier]}</option>)}
      </select>
      <select
        aria-label="Filter by evidence status"
        className={selectClass}
        onChange={(event) => {
          const nextStatus = FILTER_STATES.find((state) => state === event.target.value) ?? "all";
          onChange({ ...value, status: nextStatus });
        }}
        value={value.status}
      >
        <option value="all">All evidence states</option>
        {FILTER_STATES.map((state) => <option key={state} value={state}>{CELL_STATE_LABELS[state]}</option>)}
      </select>
      <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-xs font-medium">
        <input
          checked={value.unprovenOnly}
          className="size-4 accent-primary"
          onChange={(event) => onChange({ ...value, unprovenOnly: event.target.checked })}
          type="checkbox"
        />
        Unproven only
      </label>
      <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-xs font-medium">
        <input
          checked={value.showManual}
          className="size-4 accent-primary"
          onChange={(event) => onChange({ ...value, showManual: event.target.checked })}
          type="checkbox"
        />
        Manual evidence
      </label>
      <button className="h-9 rounded-md border border-input px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onRefresh} type="button">
        Refresh evidence
      </button>
    </div>
  );
}
