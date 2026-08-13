import { Icon } from "@bb/shared-ui/icon";
import type { RequirementTraceModel } from "./resolvers.js";
import { TraceabilityRail } from "./TraceabilityRail.js";

function evidenceTone(status: string): string {
  if (status === "verified") return "border-success/40 text-success";
  if (status === "failed" || status === "error") return "border-destructive/40 text-destructive";
  return "border-warning/40 text-warning";
}

export function RequirementDetail({
  model,
  onBack,
  onNavigate,
}: {
  model: RequirementTraceModel;
  onBack(): void;
  onNavigate(subPath: string): void;
}): React.JSX.Element {
  const requirement = model.card.requirement;
  return (
    <div className="h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start gap-3 border-b border-border pb-5">
          <button className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={onBack} type="button">
            <Icon aria-hidden="true" className="size-3.5" name="ChevronLeft" /> Back to traces
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold">{requirement.id}</h1>
              <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{requirement.ears.pattern.replaceAll("_", " ")}</span>
              <span className="rounded-md border border-border px-2 py-0.5 text-xs">{requirement.req_type} · {requirement.priority}</span>
              {model.card.local ? <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">local changes</span> : null}
              {model.card.stale ? <span className="rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">stale evidence</span> : null}
            </div>
            <p className="mt-3 max-w-5xl text-base leading-7">{requirement.ears.text}</p>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            <h2 className="text-sm font-semibold">Rationale</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{requirement.rationale ?? "No rationale is authored."}</p>
          </section>
          <section className="rounded-lg border border-border bg-card p-4 text-card-foreground">
            <h2 className="text-sm font-semibold">Original source description</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{requirement.source_description}</p>
          </section>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Inline verification contracts</h2>
          {requirement.verification.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No checks are mapped. Evidence remains Not run.</p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {requirement.verification.map((contract, index) => {
                const evidence = model.evidence.filter((item) =>
                  item.checkId === contract.check || item.tier === contract.tier,
                );
                return (
                  <article className="rounded-lg border border-border bg-card p-4 text-card-foreground" key={contract.check ?? `needs-check-${index}`}>
                    <header className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{contract.check ?? "NEEDS_CHECK_CREATION"}</span>
                      <span className="rounded-md border border-border px-2 py-0.5 text-xs">{contract.tier}</span>
                      <span className="text-xs text-muted-foreground">{contract.method} · {contract.required ? "required" : "optional"}</span>
                      {contract.check ? (
                        <button className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => onNavigate(`verifications/${requirement.id}/${contract.tier}`)} type="button">
                          Matrix cell <Icon aria-hidden="true" className="size-3" name="ExternalLink" />
                        </button>
                      ) : null}
                    </header>
                    <dl className="mt-3 space-y-2 text-xs">
                      <div><dt className="font-medium">Pass</dt><dd className="mt-0.5 text-muted-foreground">{contract.pass_criteria}</dd></div>
                      <div><dt className="font-medium">Fail</dt><dd className="mt-0.5 text-muted-foreground">{contract.fail_criteria ?? "No fail criterion authored."}</dd></div>
                      <div><dt className="font-medium">Expected evidence</dt><dd className="mt-0.5 text-muted-foreground">{contract.expected_evidence?.join(" · ") ?? "Not specified."}</dd></div>
                    </dl>
                    <div className="mt-3 space-y-2 border-t border-border pt-3">
                      {evidence.length === 0 ? <p className="text-xs text-muted-foreground">No latest evidence result.</p> : evidence.map((item) => (
                        <button className={`block w-full rounded-md border p-2 text-left text-xs ${evidenceTone(item.status)}`} key={item.resultId} onClick={() => onNavigate(`verifications/${requirement.id}/${item.tier}`)} type="button">
                          <span className="font-semibold">{item.status}</span>{item.executedAt ? ` · ${item.executedAt}` : ""}
                          <span className="mt-1 block text-foreground">{item.summary ?? "No evidence summary was cached."}</span>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <TraceabilityRail rail={model.rail} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
