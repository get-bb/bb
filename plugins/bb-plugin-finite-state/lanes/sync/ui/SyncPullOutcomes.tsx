import { Alert, AlertDescription, AlertTitle } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

import type { IsolatedPullReport, PullKindOutcome } from "../pull-outcome.js";

function OutcomeCounts({ outcome }: { outcome: PullKindOutcome }) {
  return (
    <span className="text-xs text-muted-foreground">
      {outcome.fetched.toLocaleString()} fetched ·{" "}
      {outcome.baseRows.toLocaleString()} published ·{" "}
      {outcome.quarantined.toLocaleString()} quarantined
    </span>
  );
}

export function SyncPullOutcomes({
  disabled,
  error,
  onPull,
  pulling,
  report,
}: {
  disabled: boolean;
  error: string | null;
  onPull(): void;
  pulling: boolean;
  report: IsolatedPullReport | null;
}): React.JSX.Element {
  const outcomes = report
    ? Object.entries(report.kinds).sort(([left], [right]) =>
        left.localeCompare(right),
      )
    : [];
  const published = outcomes.filter(
    ([, outcome]) => outcome.status === "published",
  ).length;
  const failed = outcomes.length - published;

  return (
    <section className="border-b border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Remote pull</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each kind publishes atomically. A failed kind does not suppress its
            successful siblings.
          </p>
        </div>
        <Button disabled={disabled || pulling} onClick={onPull} size="sm">
          <Icon aria-hidden="true" name="Download" />
          {pulling ? "Pulling kinds…" : "Pull remote kinds"}
        </Button>
      </div>

      {error ? (
        <Alert className="mt-3" variant="destructive">
          <AlertTitle>Pull report could not be loaded</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {report ? (
        <div className="mt-3 space-y-2" role="status">
          <p className="text-xs font-medium">
            {published} published · {failed} failed
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {outcomes.map(([kind, outcome]) => (
              <li className="space-y-1 px-3 py-2" key={kind}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{kind}</span>
                  <Badge
                    className={
                      outcome.status === "published"
                        ? "border-success/40 text-success"
                        : undefined
                    }
                    variant={
                      outcome.status === "published" ? "outline" : "destructive"
                    }
                  >
                    {outcome.status}
                  </Badge>
                  <OutcomeCounts outcome={outcome} />
                </div>
                {outcome.reasons.length > 0 ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {outcome.reasons
                      .map((reason) => `${reason.code}=${reason.count}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
