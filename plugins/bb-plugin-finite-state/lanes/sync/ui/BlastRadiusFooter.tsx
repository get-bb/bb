import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import type { SyncPlanPage } from "./PlanRow.js";

const TARA_KINDS = new Set([
  "component",
  "zone",
  "dataflow",
  "asset",
  "threat",
  "mitigation",
  "requirement",
  "reqCheckMap",
  "checkParams",
  "attackPath",
  "sbomLink",
]);

export interface PushSafetyState {
  plan: SyncPlanPage;
  loading: boolean;
  connectionReady: boolean;
  confirmationChecked: boolean;
  inFlight: boolean;
  authorizationAvailable: boolean;
}

export function pushDisabledReason({
  plan,
  loading,
  connectionReady,
  confirmationChecked,
  inFlight,
  authorizationAvailable,
}: PushSafetyState): string | null {
  if (!authorizationAvailable) {
    return "Human push approval is unavailable in the web panel in v1";
  }
  if (loading) return "Plan refresh in progress";
  if (inFlight) return "Push request in progress";
  if (plan.staleness.degraded || plan.cache.state !== "fresh") {
    return "Refresh the degraded or stale plan before pushing";
  }
  if (!connectionReady) return "Required remote connections are offline";
  if (
    plan.items.some(
      (item) =>
        item.operation === "conflict" ||
        item.conflicts.some((conflict) => conflict.resolution === null),
    )
  ) {
    return "Resolve every conflict before pushing";
  }
  if (
    plan.validationErrors.length > 0 ||
    plan.items.some((item) => item.error !== null)
  ) {
    return "Fix every validation error before pushing";
  }
  if (plan.items.some((item) => item.operation === "orphan")) {
    return "Reconcile every orphan before pushing";
  }
  if (plan.blastRadius.requiresHumanReview && !confirmationChecked) {
    return "Confirm the reviewed blast radius before pushing";
  }
  if (plan.blastRadius.remoteCalls === 0) return "This plan has no remote writes";
  return null;
}

function affectedDependents(plan: SyncPlanPage): number {
  return plan.items.reduce(
    (total, item) =>
      total + (item.operation === "delete" ? item.referrers.length : 0),
    0,
  );
}

export interface BlastRadiusFooterProps {
  plan: SyncPlanPage;
  loading: boolean;
  connectionReady: boolean;
  confirmationChecked: boolean;
  inFlight: boolean;
  authorizationAvailable: boolean;
  onConfirmationChange(checked: boolean): void;
  onPush(): void;
}

export function BlastRadiusFooter({
  plan,
  loading,
  connectionReady,
  confirmationChecked,
  inFlight,
  authorizationAvailable,
  onConfirmationChange,
  onPush,
}: BlastRadiusFooterProps): React.JSX.Element {
  const reason = pushDisabledReason({
    plan,
    loading,
    connectionReady,
    confirmationChecked,
    inFlight,
    authorizationAvailable,
  });
  const taraAffected = plan.blastRadius.surfaces.some((surface) =>
    TARA_KINDS.has(surface),
  );
  const dependents = affectedDependents(plan);

  return (
    <footer className="sticky bottom-0 z-10 border-t border-border bg-card/95 shadow-sm backdrop-blur">
      {taraAffected ? (
        <div
          className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs leading-5 text-foreground"
          role="status"
        >
          <Icon
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-warning"
            name="AlertTriangle"
          />
          TARA writes are bracketed by a pre-write state check and post-write
          verification. Assurance Studio exposes no atomic transaction, so a
          concurrent change can still land between those checks.
        </div>
      ) : null}
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">
              {plan.blastRadius.changed} changed
            </Badge>
            <Badge variant={plan.blastRadius.deletes > 0 ? "destructive" : "outline"}>
              {plan.blastRadius.deletes} deletes
            </Badge>
            <Badge variant="outline">{dependents} dependents</Badge>
            <Badge variant="outline">
              API-call estimate {plan.blastRadius.remoteCalls}
            </Badge>
          </div>
          <p className="mt-2 truncate text-xs text-muted-foreground">
            Affected surfaces: {plan.blastRadius.surfaces.length > 0
              ? plan.blastRadius.surfaces.join(", ")
              : "none"}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {plan.blastRadius.requiresHumanReview ? (
            <label className="flex max-w-md items-start gap-2 text-xs leading-5 text-foreground">
              <Checkbox
                aria-label="Confirm reviewed blast radius"
                checked={confirmationChecked}
                onCheckedChange={(checked) =>
                  onConfirmationChange(checked === true)
                }
              />
              <span>
                I reviewed {plan.blastRadius.changed} changes, including {plan.blastRadius.deletes} deletes.
              </span>
            </label>
          ) : null}
          <div className="text-right">
            <Button disabled={reason !== null} onClick={onPush}>
              {inFlight ? (
                <Icon aria-hidden="true" className="animate-spin" name="Loading" />
              ) : (
                <Icon aria-hidden="true" name="Lock" />
              )}
              Push reviewed plan
            </Button>
            <p
              aria-live="polite"
              className="mt-1 max-w-sm text-xs text-muted-foreground"
            >
              {reason ?? "Current plan is safe and authorized to push."}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
