import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";
import type { ResolvedAttackPath } from "./path.js";

export interface AttackPathSummary {
  routeSignature: string;
  label: string;
  totalSteps: number | null;
}

interface AttackPathOverlayProps {
  threatLabel: string;
  paths: readonly AttackPathSummary[];
  total: number;
  next: string | null;
  selectedRouteSignature: string | null;
  selectedPath: ResolvedAttackPath | null;
  loading: boolean;
  error: string | null;
  onBack(): void;
  onSelectPath(routeSignature: string): void;
  onLoadMore(): void;
}

function displayEvidence(value: unknown): string {
  if (value === null || value === undefined) return "No computed evidence";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Computed evidence is unavailable";
  }
}

export function AttackPathOverlay({
  threatLabel,
  paths,
  total,
  next,
  selectedRouteSignature,
  selectedPath,
  loading,
  error,
  onBack,
  onSelectPath,
  onLoadMore,
}: AttackPathOverlayProps): React.JSX.Element {
  return (
    <section
      aria-label="Attack paths"
      className="flex min-h-0 w-full flex-col overflow-hidden bg-card text-card-foreground"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 pr-11">
        <button
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onBack}
          type="button"
        >
          All threats
        </button>
        <Icon aria-hidden="true" className="size-4" name="GitBranch" />
        <h3
          className="min-w-0 truncate text-sm font-medium"
          title={threatLabel}
        >
          Attack paths · {threatLabel}
        </h3>
        <Badge className="ml-auto" variant="secondary">
          {total}
        </Badge>
      </div>
      {paths.length === 0 && !loading ? (
        <div className="flex min-h-24 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          No cached attack paths map to this threat.
        </div>
      ) : (
        <div className="shrink-0 border-b border-border p-2">
          <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
            {paths.map((path) => (
              <button
                aria-pressed={path.routeSignature === selectedRouteSignature}
                className={`rounded-md border px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  path.routeSignature === selectedRouteSignature
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                key={path.routeSignature}
                onClick={() => onSelectPath(path.routeSignature)}
                type="button"
              >
                {path.label}
                {path.totalSteps === null ? "" : ` · ${path.totalSteps} steps`}
              </button>
            ))}
            {next ? (
              <button
                className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={onLoadMore}
                type="button"
              >
                Load more
              </button>
            ) : null}
          </div>
        </div>
      )}
      {loading ? (
        <div
          className="flex min-h-24 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Icon
            aria-hidden="true"
            className="size-4 animate-spin"
            name="Spinner"
          />
          Loading selected path…
        </div>
      ) : null}
      {error ? (
        <div
          className="m-3 flex gap-2 rounded-md border border-destructive/40 bg-background p-3 text-sm text-foreground"
          role="alert"
        >
          <Icon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
            name="AlertTriangle"
          />
          <span>{error}</span>
        </div>
      ) : null}
      {selectedPath && !loading ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
          <ol
            aria-label="Selected attack path steps"
            className="min-h-0 overflow-auto p-3 text-xs"
            tabIndex={0}
          >
            {selectedPath.steps.map((step) => (
              <li
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-l border-border pb-3 last:pb-0"
                data-path-step={step.order}
                key={`${step.order}:${step.label}`}
              >
                <span
                  className={`-ml-3 flex size-6 items-center justify-center rounded-full border bg-card font-mono font-semibold tabular-nums ${
                    step.resolved
                      ? "border-primary text-primary"
                      : "border-destructive text-destructive"
                  }`}
                >
                  {step.resolved ? step.order : "!"}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">
                    {step.label}
                  </span>
                  {!step.resolved ? (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <Icon
                        aria-hidden="true"
                        className="size-3"
                        name="AlertTriangle"
                      />
                      Gap — no current node or dataflow maps to this step.
                    </span>
                  ) : step.ambiguous ? (
                    <span className="block text-muted-foreground">
                      Ambiguous — highlighting all{" "}
                      {step.candidateEdgeSlugs.length} parallel dataflows:{" "}
                      {step.candidateEdgeSlugs.join(", ")}.
                    </span>
                  ) : (
                    <span className="block truncate text-muted-foreground">
                      {step.edgeSlug ?? step.nodeSlug}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-2 gap-2 border-t border-border p-2 text-xs">
            <div className="rounded-md border border-border bg-muted/60 p-2">
              <p className="flex items-center gap-1 font-medium text-foreground">
                <Icon
                  aria-hidden="true"
                  className="size-3.5"
                  name="ChartColumn"
                />
                Derived exploitability
              </p>
              <p className="mt-1 break-words font-mono text-muted-foreground">
                {displayEvidence(selectedPath.view.exploitability)}
              </p>
              <p className="mt-1 text-muted-foreground">
                Display-only evidence
              </p>
            </div>
            <div className="rounded-md border border-border bg-background p-2">
              <p className="flex items-center gap-1 font-medium text-foreground">
                <Icon
                  aria-hidden="true"
                  className="size-3.5"
                  name="UserRound"
                />
                Local viability decision
              </p>
              <Badge className="mt-1" variant="outline">
                {selectedPath.view.viability === "unknown"
                  ? "No local decision"
                  : selectedPath.view.viability.replaceAll("_", " ")}
              </Badge>
              <p className="mt-1 text-muted-foreground">
                Never inferred from exploitability.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
