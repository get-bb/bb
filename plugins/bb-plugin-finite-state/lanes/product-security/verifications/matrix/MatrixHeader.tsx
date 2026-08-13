import { Badge } from "@bb/shared-ui/badge";
import type { MatrixRollup, VerificationTier } from "./status.js";
import { TIER_LABELS } from "./status.js";

export function MatrixHeader({
  columns,
  rollup,
}: {
  columns: readonly VerificationTier[];
  rollup: MatrixRollup | null;
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur" role="row">
      <div
        className="grid min-w-max gap-2 px-3 py-2"
        style={{ gridTemplateColumns: `minmax(18rem, 1fr) repeat(${columns.length}, minmax(7rem, 0.62fr))` }}
      >
        <div className="flex min-w-72 items-center gap-2" role="columnheader">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requirement</span>
          {rollup ? (
            <span className="ml-auto flex items-center gap-1.5 pr-2">
              <Badge variant="outline">{rollup.requirements} loaded</Badge>
              {rollup.failed + rollup.error > 0 ? (
                <Badge variant="destructive">{rollup.failed + rollup.error} failing</Badge>
              ) : null}
            </span>
          ) : null}
        </div>
        {columns.map((tier) => (
          <div className="flex min-w-28 items-center justify-center text-xs font-semibold uppercase tracking-wide text-muted-foreground" key={tier} role="columnheader">
            {TIER_LABELS[tier]}
          </div>
        ))}
      </div>
    </div>
  );
}
