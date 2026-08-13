import type { RequirementEvidenceState, TierSummary } from "./schema.js";

const STATE: Record<RequirementEvidenceState, { label: string; className: string }> = {
  verified: { label: "pass", className: "text-success" },
  partial: { label: "partial", className: "text-warning" },
  failed: { label: "fail", className: "text-destructive" },
  not_run: { label: "not run", className: "text-muted-foreground" },
};

export function TierStrip({ tiers }: { tiers: readonly TierSummary[] }): React.JSX.Element {
  return (
    <div aria-label="Verification tiers" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {tiers.map((tier) => {
        const status = STATE[tier.state];
        return (
          <span
            aria-label={`${tier.tier}: ${tier.count === 0 ? "no mapped checks" : `${tier.count} ${tier.state}`}`}
            className="inline-flex items-center gap-1 text-muted-foreground"
            key={tier.tier}
          >
            <span className="uppercase tracking-wide">{tier.tier}</span>
            {tier.count === 0 ? (
              <span aria-hidden>—</span>
            ) : (
              <>
                <span className={status.className}>{status.label}</span>
                <span className="tabular-nums">{tier.count}</span>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
