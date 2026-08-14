import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import { Label } from "@bb/shared-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { Textarea } from "@bb/shared-ui/textarea";
import type {
  VexJustification,
  VexResponse,
} from "../../../../lib/remote/types.js";
import { JustificationPicker } from "./JustificationPicker.js";
import {
  VEX_RESPONSE_VALUES,
  type TriageDraft,
  validateTriageDraft,
} from "./validation.js";

interface PriorDecision {
  status: TriageDraft["status"];
  justification: TriageDraft["justification"];
  response: TriageDraft["response"];
  reason: string;
  pin: TriageDraft["pin"];
  provenance: { by: string; at: string; evidence: string };
}

export interface TriageWriteError {
  kind: "conflict" | "write";
  message: string;
  file: string | null;
}

export function TriageEditor({
  draft,
  targetLabel,
  seededReason,
  reasonConfirmed,
  pending,
  commitBlockedReason,
  prior,
  error,
  onChange,
  onReasonConfirmed,
  onCommit,
  onCancel,
  onReload,
}: {
  draft: TriageDraft;
  targetLabel: string;
  seededReason: boolean;
  reasonConfirmed: boolean;
  pending: boolean;
  commitBlockedReason: string | null;
  prior: PriorDecision | null;
  error: TriageWriteError | null;
  onChange(draft: TriageDraft): void;
  onReasonConfirmed(confirmed: boolean): void;
  onCommit(): void;
  onCancel(): void;
  onReload(): void;
}): React.JSX.Element {
  const validation = validateTriageDraft(draft);
  const validationMessage = validation.ok ? null : validation.message;
  const [showCompare, setShowCompare] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);
  const exactPin = draft.justification === "CODE_NOT_REACHABLE";

  const justification = (value: VexJustification) => {
    onChange({
      ...draft,
      justification: value,
      ...(value === "CODE_NOT_REACHABLE"
        ? { pin: "exact_version" as const }
        : {}),
    });
  };

  const attemptCommit = () => {
    if (pending) {
      setSubmitFeedback("A local write is already in progress.");
      return;
    }
    if (commitBlockedReason) {
      setSubmitFeedback(commitBlockedReason);
      return;
    }
    if (!validation.ok) {
      setSubmitFeedback(validation.message);
      return;
    }
    if (!reasonConfirmed) {
      setSubmitFeedback(
        "Confirm that you reviewed the reason and evidence before writing YAML.",
      );
      return;
    }
    setSubmitFeedback(null);
    onCommit();
  };

  return (
    <form
      aria-busy={pending}
      aria-label={`Triage ${targetLabel}`}
      className="border-y border-primary/30 bg-card shadow-[inset_3px_0_0_var(--primary)]"
      onKeyDown={(event) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
        event.preventDefault();
        attemptCommit();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        attemptCommit();
      }}
    >
      <div className="flex items-start gap-4 px-4 py-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="size-4" name="EditFile" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Local YAML decision
              </p>
              <h2 className="mt-0.5 truncate text-sm font-semibold">
                {targetLabel}
              </h2>
              <p className="mt-1 font-mono text-xs text-primary">
                {draft.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={onCancel}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                aria-keyshortcuts="Control+Enter Meta+Enter"
                aria-describedby={
                  commitBlockedReason ? "triage-commit-blocked" : undefined
                }
                disabled={
                  pending ||
                  Boolean(commitBlockedReason) ||
                  !reasonConfirmed ||
                  !validation.ok
                }
                size="sm"
                type="submit"
              >
                {pending ? (
                  <Icon
                    aria-hidden="true"
                    className="size-4 animate-spin"
                    name="Loading"
                  />
                ) : (
                  <Icon
                    aria-hidden="true"
                    className="size-4"
                    name="CircleCheck"
                  />
                )}
                Write YAML{" "}
                <kbd className="ml-1 text-[0.7rem] opacity-70">⌘↵</kbd>
              </Button>
            </div>
          </div>

          {prior ? (
            <section
              aria-label="Existing local decision being replaced"
              className="mt-4 rounded-md border border-warning/40 bg-muted/30 p-3 text-xs"
            >
              <div className="flex items-center gap-2">
                <Icon
                  aria-hidden="true"
                  className="size-4 text-warning"
                  name="AlertTriangle"
                />
                <p className="font-medium">
                  Replacing an existing local decision
                </p>
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-mono">{prior.status}</dd>
                <dt className="text-muted-foreground">Justification</dt>
                <dd>{prior.justification?.replaceAll("_", " ") ?? "None"}</dd>
                <dt className="text-muted-foreground">Response</dt>
                <dd>{prior.response?.replaceAll("_", " ") ?? "None"}</dd>
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {prior.reason}
                </dd>
                <dt className="text-muted-foreground">Evidence</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {prior.provenance.evidence}
                </dd>
                <dt className="text-muted-foreground">Authored</dt>
                <dd>
                  {prior.provenance.by} · {prior.provenance.at}
                </dd>
              </dl>
              <p className="mt-2 text-muted-foreground">
                The replacement draft below starts from these authored fields.
                Review and confirm every change before writing.
              </p>
            </section>
          ) : null}

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {draft.status === "NOT_AFFECTED" ? (
              <JustificationPicker
                onChange={justification}
                value={draft.justification}
              />
            ) : (
              <div className="space-y-2">
                <Label>Justification</Label>
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Not required for {draft.status.replaceAll("_", " ")}.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label id="triage-response-label">
                Response{" "}
                <span className="font-normal text-muted-foreground">
                  optional
                </span>
              </Label>
              <Select
                onValueChange={(value) =>
                  onChange({
                    ...draft,
                    response: value === "none" ? null : (value as VexResponse),
                  })
                }
                value={draft.response ?? "none"}
              >
                <SelectTrigger
                  aria-label="Response"
                  aria-labelledby="triage-response-label"
                  id="triage-response"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No response</SelectItem>
                  {VEX_RESPONSE_VALUES.map((response) => (
                    <SelectItem key={response} value={response}>
                      {response.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="triage-reason">Reason</Label>
              <Textarea
                id="triage-reason"
                onChange={(event) => {
                  onReasonConfirmed(false);
                  onChange({ ...draft, reason: event.target.value });
                }}
                rows={3}
                value={draft.reason}
              />
              {seededReason ? (
                <p className="text-xs text-warning">
                  Seeded from cached reachability evidence. Review and
                  explicitly confirm it; a seed is not approval.
                </p>
              ) : null}
            </div>
            <div className="space-y-2 xl:col-span-2">
              <Label htmlFor="triage-evidence">Evidence reviewed</Label>
              <Textarea
                id="triage-evidence"
                onChange={(event) => {
                  onReasonConfirmed(false);
                  onChange({ ...draft, evidence: event.target.value });
                }}
                rows={3}
                value={draft.evidence}
              />
            </div>
            <div className="space-y-2">
              <Label id="triage-pin-label">Version pin</Label>
              <Select
                disabled={exactPin}
                onValueChange={(value) =>
                  onChange({ ...draft, pin: value as TriageDraft["pin"] })
                }
                value={draft.pin}
              >
                <SelectTrigger
                  aria-describedby={exactPin ? "triage-pin-locked" : undefined}
                  aria-label="Version pin"
                  aria-labelledby="triage-pin-label"
                  id="triage-pin"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact_version">Exact version</SelectItem>
                  <SelectItem value="any_version">Any version</SelectItem>
                </SelectContent>
              </Select>
              {exactPin ? (
                <p
                  className="text-xs text-muted-foreground"
                  id="triage-pin-locked"
                >
                  CODE_NOT_REACHABLE evidence is build-specific, so promotion is
                  disabled.
                </p>
              ) : null}
            </div>
            <label className="flex items-start gap-2 self-end rounded-md border border-border bg-muted/20 p-3 text-xs">
              <Checkbox
                checked={reasonConfirmed}
                onCheckedChange={(checked) =>
                  onReasonConfirmed(checked === true)
                }
              />
              <span>
                <strong className="block font-medium text-foreground">
                  I reviewed this reason and evidence
                </strong>
                <span className="mt-1 block text-muted-foreground">
                  The plugin will record exactly this authored rationale.
                </span>
              </span>
            </label>
          </div>

          {!validation.ok ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {validation.message}
            </p>
          ) : null}
          {commitBlockedReason ? (
            <p
              className="mt-3 text-xs text-destructive"
              id="triage-commit-blocked"
              role="alert"
            >
              {commitBlockedReason}
            </p>
          ) : null}
          {!reasonConfirmed && validation.ok ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Confirm that you reviewed the reason and evidence to enable Write
              YAML.
            </p>
          ) : null}
          {submitFeedback &&
          submitFeedback !== commitBlockedReason &&
          submitFeedback !== validationMessage &&
          (pending ||
            Boolean(commitBlockedReason) ||
            !reasonConfirmed ||
            !validation.ok) ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {submitFeedback}
            </p>
          ) : null}
          {error ? (
            <div
              className="mt-3 rounded-md border border-destructive/40 bg-muted p-3 text-xs"
              role="alert"
            >
              <div className="flex items-start gap-2">
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  name="AlertTriangle"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {error.kind === "conflict"
                      ? "A newer YAML file was preserved"
                      : "This decision was not written"}
                  </p>
                  <p className="mt-1 break-words text-muted-foreground">
                    {error.message}
                  </p>
                </div>
              </div>
              {error.kind === "conflict" ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={onReload}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Reload CAS base
                  </Button>
                  <Button
                    onClick={() => setShowCompare((value) => !value)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Compare
                  </Button>
                </div>
              ) : null}
              {showCompare ? (
                <p className="mt-2 rounded border border-border bg-background p-2 text-muted-foreground">
                  Your draft remains above. Compare it with{" "}
                  {error.file ?? "the newer overlay"} in the Changes panel, then
                  reload the CAS base before retrying.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}
