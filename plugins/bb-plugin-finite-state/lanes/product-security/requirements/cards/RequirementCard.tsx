import { useEffect, useState } from "react";
import { useBbContext, useRpc } from "@bb/plugin-sdk/app";
import type { JsonValue, RpcContract } from "../../../../shared/contract.js";
import { RequirementEditor } from "./RequirementEditor.js";
import { StatusPill } from "./StatusPill.js";
import { TierStrip } from "./TierStrip.js";
import { requirementCardModelSchema, type RequirementCardModel } from "./schema.js";

const EARS_KEYWORD = /\b(WHEN|WHILE|IF|THEN|WHERE|SHALL)\b/gu;
const EARS_KEYWORDS = new Set(["WHEN", "WHILE", "IF", "THEN", "WHERE", "SHALL"]);

function EarsText({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="text-sm leading-6 text-card-foreground">
      {text.split(EARS_KEYWORD).map((part, index) =>
        EARS_KEYWORDS.has(part) ? (
          <strong className="font-semibold tracking-wide text-foreground" key={`${part}-${index}`}>{part}</strong>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      )}
    </p>
  );
}

function parseModel(fields: Record<string, JsonValue>): RequirementCardModel {
  return requirementCardModelSchema.parse(fields);
}

export function RequirementCard({
  id,
  initialModel,
}: {
  id: string;
  initialModel?: RequirementCardModel;
}): React.JSX.Element {
  const { projectId } = useBbContext();
  const rpc = useRpc<RpcContract>();
  const [model, setModel] = useState<RequirementCardModel | null>(initialModel ?? null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (initialModel || !projectId) return;
    let active = true;
    const request = { projectId, projectVersionId: null, requirementId: id };
    void rpc.call("requirementsGet", request).then((result) => {
      if (!active) return;
      setModel(parseModel(result.fields));
      setError(null);
    }).catch((nextError: unknown) => {
      if (!active) return;
      setError(nextError instanceof Error ? nextError.message : "Requirement could not be loaded.");
    });
    return () => { active = false; };
  }, [id, initialModel, projectId, rpc]);

  if (error) {
    return <article className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-card-foreground" role="alert">{error}</article>;
  }
  if (!model) {
    return (
      <article aria-label={`Loading requirement ${id}`} className="space-y-3 rounded-lg border border-border bg-card p-4" role="status">
        <div className="h-5 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-16 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded-md bg-muted" />
      </article>
    );
  }

  const requirement = model.requirement;
  const traces = [...requirement.standards, ...requirement.mitigations, ...requirement.controls].slice(0, 3);
  return (
    <article className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs" data-requirement-id={id}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{requirement.id}</span>
          <span className="inline-flex items-center rounded-md border border-transparent bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">{requirement.ears.pattern.replaceAll("_", "-")}</span>
          <span className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-semibold">{requirement.req_type} · {requirement.priority}</span>
          <span
            aria-label={`Workflow status: ${requirement.status}; this is not evidence`}
            className="border-border text-muted-foreground"
            title="Authored workflow state — not verification evidence"
          >
            workflow: {requirement.status}
          </span>
          {model.local ? <span className="inline-flex items-center rounded-md bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">local</span> : null}
          {model.stale ? (
            <span className="inline-flex items-center rounded-md border border-warning/40 px-2.5 py-0.5 text-xs font-semibold text-warning">stale</span>
          ) : null}
        </div>
        <StatusPill state={model.evidenceState} />
      </header>

      <div className="mt-4"><EarsText text={requirement.ears.text} /></div>
      <div className="mt-4 border-t border-border pt-3">
        <TierStrip tiers={model.tiers} />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Traces</span>
          {traces.length === 0 ? <span>None authored</span> : traces.map((trace) => <span className="font-mono" key={trace}>{trace}</span>)}
          {requirement.standards.length + requirement.mitigations.length + requirement.controls.length > traces.length ? <span>+more</span> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          aria-expanded={expanded}
          className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Collapse" : "Expand requirement"}
        </button>
        {expanded ? (
          <button aria-pressed={editing} className="inline-flex h-8 items-center justify-center rounded-md border border-input px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => setEditing((value) => !value)} type="button">
            {editing ? "Close editor" : "Edit local YAML"}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <section aria-label={`${requirement.id} details`} className="mt-4 space-y-3 text-sm">
          <div>
            <h3 className="font-medium">Rationale</h3>
            <p className="mt-1 text-muted-foreground">{requirement.rationale ?? "No rationale authored."}</p>
          </div>
          <div>
            <h3 className="font-medium">Original source description</h3>
            <p className="mt-1 text-muted-foreground">{requirement.source_description}</p>
          </div>
          <div>
            <h3 className="font-medium">Inline verification contracts</h3>
            {requirement.verification.length === 0 ? (
              <p className="mt-1 text-muted-foreground">No checks mapped. Evidence status remains Not run.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {requirement.verification.map((contract, index) => (
                  <li className="rounded-md border border-border bg-background p-3" key={contract.check ?? `needs-check-${index}`}>
                    <span className="font-mono text-xs">{contract.check ?? "NEEDS_CHECK_CREATION"}</span>
                    <p className="mt-1 text-muted-foreground">{contract.tier} · {contract.method} · {contract.required ? "required" : "optional"}</p>
                    <p className="mt-1">Pass: {contract.pass_criteria}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {editing ? <RequirementEditor model={model} onSaved={(sourceSha256) => setModel({ ...model, sourceSha256, local: true })} /> : null}
        </section>
      ) : null}
    </article>
  );
}
