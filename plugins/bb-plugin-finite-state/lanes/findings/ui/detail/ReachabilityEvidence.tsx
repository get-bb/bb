import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";
import type { EvidenceFactor } from "./useFindingDetail.js";

export function ReachabilityEvidence({
  verdict,
  factors,
}: {
  verdict: "reachable" | "unreachable" | "unknown";
  factors: readonly EvidenceFactor[];
}): React.JSX.Element {
  return (
    <section aria-labelledby="finding-reachability" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-primary" name="Target" />
          <h3 className="text-sm font-semibold" id="finding-reachability">Reachability evidence</h3>
        </div>
        <Badge variant={verdict === "reachable" ? "destructive" : verdict === "unreachable" ? "secondary" : "outline"}>
          {verdict}
        </Badge>
      </div>
      {factors.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <p className="font-medium">Unknown — no evidence factors were cached</p>
          <p className="mt-1 text-muted-foreground">Missing or negative evidence is not proof that vulnerable code is unreachable.</p>
        </div>
      ) : (
        <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background text-xs">
          {factors.map((factor, index) => (
            <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(10rem,2fr)] gap-3 p-3" key={`${factor.label}:${factor.value}:${index}`}>
              <dt className="font-medium">{factor.label}</dt>
              <dd className="min-w-0">
                <p className="break-words font-mono">{factor.value}</p>
                {factor.source ? <p className="mt-1 text-muted-foreground">Source: {factor.source}</p> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
