import { useMemo, useState } from "react";
import { useBbContext, useRpc } from "@bb/plugin-sdk/app";
import type { JsonValue, RpcContract } from "../../../../shared/contract.js";
import { renderEars } from "./render-ears.js";
import {
  earsPatternSchema,
  requirementCardModelSchema,
  requirementWorkflowStatusSchema,
  type EarsPattern,
  type RequirementCardModel,
  type RequirementYamlV1,
} from "./schema.js";
import { validateRequirement } from "./validator.js";

const INPUT_CLASS = "flex min-h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const LABEL_CLASS = "text-sm font-medium leading-none";

function requirementFields(requirement: RequirementYamlV1): Record<string, JsonValue> {
  return {
    schema: requirement.schema,
    id: requirement.id,
    req_type: requirement.req_type,
    priority: requirement.priority,
    status: requirement.status,
    ears: {
      pattern: requirement.ears.pattern,
      text: requirement.ears.text,
      parts: {
        trigger: requirement.ears.parts.trigger ?? null,
        precondition: requirement.ears.parts.precondition ?? null,
        state: requirement.ears.parts.state ?? null,
        feature: requirement.ears.parts.feature ?? null,
        system: requirement.ears.parts.system,
        response: requirement.ears.parts.response,
      },
    },
    ...(requirement.rationale === undefined ? {} : { rationale: requirement.rationale }),
    source_description: requirement.source_description,
    mitigations: requirement.mitigations,
    controls: requirement.controls,
    standards: requirement.standards,
    verification: requirement.verification.map((contract) => ({
      check: contract.check,
      method: contract.method,
      tier: contract.tier,
      required: contract.required,
      ...(contract.coverage === undefined ? {} : { coverage: contract.coverage }),
      ...(contract.suppressed === undefined ? {} : { suppressed: contract.suppressed }),
      pass_criteria: contract.pass_criteria,
      ...(contract.fail_criteria === undefined ? {} : { fail_criteria: contract.fail_criteria }),
      ...(contract.expected_evidence === undefined
        ? {}
        : { expected_evidence: contract.expected_evidence }),
    })),
  };
}

function relevantParts(pattern: EarsPattern): readonly ("trigger" | "precondition" | "state" | "feature")[] {
  switch (pattern) {
    case "event_driven":
    case "unwanted_behavior":
      return ["trigger"];
    case "state_driven":
      return ["state"];
    case "optional_feature":
      return ["feature"];
    case "complex":
      return ["feature", "precondition", "state", "trigger"];
    case "ubiquitous":
      return [];
  }
}

export function RequirementEditor({
  model,
  projectId: selectedProjectId,
  projectVersionId,
  onConflict,
  onSaved,
}: {
  model: RequirementCardModel;
  projectId?: string | null;
  projectVersionId: string | null;
  onConflict?(current: RequirementCardModel): void;
  onSaved?(next: RequirementYamlV1, nextSha256: string): void;
}): React.JSX.Element {
  const { projectId: routeProjectId } = useBbContext();
  const projectId = selectedProjectId ?? routeProjectId;
  const rpc = useRpc<RpcContract>();
  const source = model.requirement;
  const [pattern, setPattern] = useState<EarsPattern>(source.ears.pattern);
  const [workflowStatus, setWorkflowStatus] = useState(source.status);
  const [system, setSystem] = useState(source.ears.parts.system);
  const [response, setResponse] = useState(source.ears.parts.response);
  const [trigger, setTrigger] = useState(source.ears.parts.trigger ?? "");
  const [precondition, setPrecondition] = useState(source.ears.parts.precondition ?? "");
  const [state, setState] = useState(source.ears.parts.state ?? "");
  const [feature, setFeature] = useState(source.ears.parts.feature ?? "");
  const [rationale, setRationale] = useState(source.rationale ?? "");
  const [sourceDescription, setSourceDescription] = useState(source.source_description);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const visibleParts = useMemo(() => relevantParts(pattern), [pattern]);

  function draft(): RequirementYamlV1 {
    const withoutRationale = { ...source };
    delete withoutRationale.rationale;
    const parts = {
      trigger: visibleParts.includes("trigger") ? trigger.trim() || null : null,
      precondition: visibleParts.includes("precondition") ? precondition.trim() || null : null,
      state: visibleParts.includes("state") ? state.trim() || null : null,
      feature: visibleParts.includes("feature") ? feature.trim() || null : null,
      system: system.trim(),
      response: response.trim(),
    };
    const ears = { pattern, text: "", parts };
    ears.text = renderEars(ears);
    return {
      ...withoutRationale,
      status: workflowStatus,
      ears,
      ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      source_description: sourceDescription.trim(),
    };
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!projectId) return;
    const next = draft();
    const validation = validateRequirement(next);
    if (!validation.success) {
      setMessage(validation.errors.map((error) => error.message).join(" "));
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const request = {
        projectId,
        projectVersionId,
        requirementId: source.id,
        fields: requirementFields(validation.data),
        expectedContentSha256: model.sourceSha256,
      };
      const result = await rpc.call("requirementsWrite", request);
      setMessage("Saved to tracked local YAML. Remote systems were not contacted.");
      onSaved?.(validation.data, result.afterSha256);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith("LOCAL_WRITE_CONFLICT:")) {
        try {
          const current = await rpc.call("requirementsGet", {
            projectId,
            projectVersionId,
            requirementId: source.id,
          });
          onConflict?.(requirementCardModelSchema.parse(current.fields));
          setMessage("This requirement changed on disk. The latest version is loaded; review it before saving again.");
        } catch {
          setMessage("This requirement changed on disk, but the latest version could not be loaded. Retry the local read before saving.");
        }
      } else {
        setMessage(detail || "The requirement could not be saved to tracked local YAML. Review the fields and retry.");
      }
    } finally {
      setSaving(false);
    }
  }

  const partState = { trigger, precondition, state, feature };
  function setPart(part: "trigger" | "precondition" | "state" | "feature", value: string): void {
    if (part === "trigger") setTrigger(value);
    else if (part === "precondition") setPrecondition(value);
    else if (part === "state") setState(value);
    else setFeature(value);
  }
  return (
    <form className="mt-4 space-y-4 border-t border-border pt-4" onSubmit={(event) => void save(event)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={LABEL_CLASS} htmlFor={`${source.id}-pattern`}>EARS pattern</label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            id={`${source.id}-pattern`}
            onChange={(event) => setPattern(earsPatternSchema.parse(event.target.value))}
            value={pattern}
          >
            {earsPatternSchema.options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={LABEL_CLASS} htmlFor={`${source.id}-workflow`}>Workflow state (not evidence)</label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            id={`${source.id}-workflow`}
            onChange={(event) => setWorkflowStatus(requirementWorkflowStatusSchema.parse(event.target.value))}
            value={workflowStatus}
          >
            {requirementWorkflowStatusSchema.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">“Verified” here is an authored workflow stage. Proof is shown only by the evidence pill.</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className={LABEL_CLASS} htmlFor={`${source.id}-system`}>System</label>
        <input className={INPUT_CLASS} id={`${source.id}-system`} onChange={(event) => setSystem(event.target.value)} value={system} />
      </div>
      {visibleParts.map((part) => {
        return (
          <div className="space-y-1.5" key={part}>
            <label className={LABEL_CLASS} htmlFor={`${source.id}-${part}`}>{part.replaceAll("_", " ")}</label>
            <input
              className={INPUT_CLASS}
              id={`${source.id}-${part}`}
              onChange={(event) => setPart(part, event.target.value)}
              value={partState[part]}
            />
          </div>
        );
      })}
      <div className="space-y-1.5">
        <label className={LABEL_CLASS} htmlFor={`${source.id}-response`}>Required response</label>
        <textarea className={INPUT_CLASS} id={`${source.id}-response`} onChange={(event) => setResponse(event.target.value)} value={response} />
      </div>
      <div className="space-y-1.5">
        <label className={LABEL_CLASS} htmlFor={`${source.id}-rationale`}>Rationale</label>
        <textarea className={INPUT_CLASS} id={`${source.id}-rationale`} onChange={(event) => setRationale(event.target.value)} value={rationale} />
      </div>
      <div className="space-y-1.5">
        <label className={LABEL_CLASS} htmlFor={`${source.id}-source`}>Original source description</label>
        <textarea className={INPUT_CLASS} id={`${source.id}-source`} onChange={(event) => setSourceDescription(event.target.value)} required value={sourceDescription} />
      </div>
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
      <button className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" disabled={saving || !projectId} type="submit">{saving ? "Saving local YAML…" : "Save local YAML"}</button>
    </form>
  );
}
