import { memo } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@bb/shared-ui/collapsible";
import { Icon } from "@bb/shared-ui/icon";
import type { z } from "zod";
import type { EntityKind } from "../../../lib/sync/registry.js";
import type { rpcContract } from "../../../shared/contract.js";
import {
  ConflictResolution,
  type ConflictChoice,
  type ConflictView,
} from "./ConflictResolution.js";
import { DomainDiff } from "./domain-renderers.js";
import { FieldDiff, type FieldDiffView } from "./FieldDiff.js";

export type SyncPlanPage = z.output<
  (typeof rpcContract)["syncPlan"]["output"]
>;
export type SyncPlanItem = SyncPlanPage["items"][number];
export type SyncPlanOperation = SyncPlanItem["operation"];

const ENTITY_KINDS = [
  "component",
  "zone",
  "dataflow",
  "asset",
  "threat",
  "mitigation",
  "requirement",
  "hbomPart",
  "vexDecision",
  "reqCheckMap",
  "checkParams",
  "attackPath",
  "sbomLink",
  "firmwareLink",
  "canvasLayout",
  "finding",
  "sbomComponent",
  "standardClause",
  "attackPathBody",
  "verificationRun",
  "verificationResult",
  "firmwareMount",
  "document",
  "hbomDoc",
  "reviewTransition",
  "verificationDispatch",
  "benchDispatch",
  "firmwareMaterialize",
] as const satisfies readonly EntityKind[];

export function isEntityKind(kind: string): kind is EntityKind {
  return ENTITY_KINDS.some((candidate) => candidate === kind);
}

const ENTITY_LABELS: Readonly<Record<EntityKind, string>> = {
  component: "Component",
  zone: "Trust zone",
  dataflow: "Data flow",
  asset: "Asset",
  threat: "Threat",
  mitigation: "Mitigation",
  requirement: "Requirement",
  hbomPart: "Hardware part",
  vexDecision: "VEX decision",
  reqCheckMap: "Requirement check map",
  checkParams: "Check parameters",
  attackPath: "Attack path",
  sbomLink: "SBOM link",
  firmwareLink: "Firmware link",
  canvasLayout: "Canvas layout",
  finding: "Finding",
  sbomComponent: "SBOM component",
  standardClause: "Standard clause",
  attackPathBody: "Attack path body",
  verificationRun: "Verification run",
  verificationResult: "Verification result",
  firmwareMount: "Firmware mount",
  document: "Document",
  hbomDoc: "HBOM document",
  reviewTransition: "Review transition",
  verificationDispatch: "Verification dispatch",
  benchDispatch: "Bench dispatch",
  firmwareMaterialize: "Firmware materialization",
};

export function entityKindLabel(kind: string): string {
  return isEntityKind(kind) ? ENTITY_LABELS[kind] : "Unknown entity";
}

const OPERATION_STYLES: Readonly<Record<SyncPlanOperation, string>> = {
  create: "border-success/40 bg-success/10 text-success",
  update: "border-primary/40 bg-primary/10 text-primary",
  delete: "border-destructive/40 bg-destructive/10 text-destructive",
  conflict: "border-destructive/40 bg-destructive/10 text-destructive",
  orphan: "border-border bg-muted text-foreground",
  noop: "border-border bg-background text-muted-foreground",
};

function operationLabel(operation: SyncPlanOperation): string {
  if (operation === "noop") return "No change";
  return operation[0]!.toUpperCase() + operation.slice(1);
}

export function planItemId(item: SyncPlanItem): string {
  return `${item.kind}\0${item.key}`;
}

function changeSummary(item: SyncPlanItem): string {
  const parts: string[] = [];
  if (item.fields.length > 0) {
    parts.push(`${item.fields.length} ${item.fields.length === 1 ? "field" : "fields"}`);
  }
  if (item.conflicts.length > 0) {
    parts.push(`${item.conflicts.length} ${item.conflicts.length === 1 ? "conflict" : "conflicts"}`);
  }
  if (item.referrers.length > 0) {
    parts.push(`${item.referrers.length} ${item.referrers.length === 1 ? "dependent" : "dependents"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Identity or presence changed";
}

export interface PlanRowResolutionState {
  submittingField: string | null;
  errorField: string | null;
  error: string | null;
}

export interface PlanRowProps {
  item: SyncPlanItem;
  expanded: boolean;
  authorizationAvailable: boolean;
  resolutionState: PlanRowResolutionState;
  onExpandedChange(expanded: boolean): void;
  onResolve(
    item: SyncPlanItem,
    field: string,
    resolution: ConflictChoice,
  ): Promise<void>;
}

function UnknownDomainDiff({ id }: { id: string }): React.JSX.Element {
  return (
    <section
      aria-label="Unknown entity identity"
      className="rounded-md border border-border bg-muted/30 px-3 py-2"
    >
      <p className="text-xs font-medium text-muted-foreground">
        Unknown entity type
      </p>
      <p className="mt-1 break-all font-mono text-xs text-foreground">{id}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        The identity is preserved and semantic field changes remain visible.
      </p>
    </section>
  );
}

export const PlanRow = memo(function PlanRow({
  item,
  expanded,
  authorizationAvailable,
  resolutionState,
  onExpandedChange,
  onResolve,
}: PlanRowProps): React.JSX.Element {
  const rowId = planItemId(item);
  return (
    <Collapsible onOpenChange={onExpandedChange} open={expanded}>
      <div
        className="border-b border-border bg-background text-foreground hover:bg-muted/40"
        data-plan-row={rowId}
      >
        <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 md:grid-cols-[8rem_minmax(0,1fr)_minmax(10rem,0.7fr)_auto]">
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                aria-label={`${expanded ? "Collapse" : "Expand"} ${item.label}`}
                className="size-8"
                size="icon"
                variant="ghost"
              >
                <Icon
                  aria-hidden="true"
                  className="size-3.5"
                  name={expanded ? "ChevronDown" : "ChevronRight"}
                />
              </Button>
            </CollapsibleTrigger>
            <Badge className={OPERATION_STYLES[item.operation]} variant="outline">
              {operationLabel(item.operation)}
            </Badge>
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.label}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {item.key}
            </p>
          </div>

          <div className="hidden min-w-0 md:block">
            <p className="text-xs font-medium text-foreground">
              {entityKindLabel(item.kind)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {changeSummary(item)}
            </p>
          </div>

          <div className="flex justify-end gap-1.5">
            {item.error ? (
              <Badge variant="destructive">Validation error</Badge>
            ) : (
              <Badge variant="outline">Validated</Badge>
            )}
            {item.conflicts.some((conflict) => conflict.resolution === null) ? (
              <Badge variant="destructive">Needs decision</Badge>
            ) : null}
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-5 border-t border-border bg-card/60 px-4 py-4 md:px-12">
            {isEntityKind(item.kind) ? (
              <DomainDiff id={item.key} kind={item.kind} />
            ) : (
              <UnknownDomainDiff id={item.key} />
            )}

            {item.error ? (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
                role="alert"
              >
                <p className="text-sm font-medium text-destructive">
                  {item.error.code}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.error.message}
                </p>
                {item.error.artifactId ? (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {item.error.artifactId}
                    {item.error.line ? `:${item.error.line}` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}

            {item.fields.length > 0 ? (
              <div aria-label="Semantic field changes" className="space-y-4">
                {item.fields.map((field: FieldDiffView) => (
                  <FieldDiff diff={field} key={field.field} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This operation changes entity presence or identity without a
                field-level value change.
              </p>
            )}

            {item.conflicts.length > 0 ? (
              <div aria-label="Conflict decisions" className="space-y-3">
                {item.conflicts.map((conflict: ConflictView) => (
                  <ConflictResolution
                    authorizationAvailable={authorizationAvailable}
                    conflict={conflict}
                    error={
                      resolutionState.errorField === conflict.field
                        ? resolutionState.error
                        : null
                    }
                    key={conflict.field}
                    onResolve={(resolution) =>
                      onResolve(item, conflict.field, resolution)
                    }
                    submitting={
                      resolutionState.submittingField === conflict.field
                    }
                  />
                ))}
              </div>
            ) : null}

            {item.referrers.length > 0 ? (
              <section aria-label="Dependent entities">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Dependents
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {item.referrers.map((referrer) => (
                    <li className="flex min-w-0 items-baseline gap-2" key={`${referrer.kind}\0${referrer.key}`}>
                      <span className="truncate">{referrer.label}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {referrer.key}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
});
