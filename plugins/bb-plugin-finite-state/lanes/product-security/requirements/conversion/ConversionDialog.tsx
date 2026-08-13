import { Icon } from "@bb/shared-ui/icon";
import type { JsonValue } from "../../../../shared/contract.js";
import { ConversionStatus, type ConversionDisplayState } from "./ConversionStatus.js";

export interface ConversionDialogModel {
  id: string;
  projectVersionId: string | null;
  state: ConversionDisplayState;
  requirementIds: string[];
  snapshotSha256: string;
  errors: Array<{ code: string; message: string; artifactId: string | null; line: number | null }>;
  diffComplete?: boolean;
  diffError?: string;
  diff?: Array<{
    key: string;
    label: string;
    operation: "create" | "update" | "delete" | "noop" | "conflict" | "orphan";
    fields: Array<{ field: string; base: { present: boolean; value: JsonValue }; ours: { present: boolean; value: JsonValue }; theirs: { present: boolean; value: JsonValue } }>;
  }>;
}

function diffValue(value: { present: boolean; value: JsonValue }): string {
  if (!value.present) return "∅";
  const encoded = JSON.stringify(value.value);
  return (encoded ?? "null").slice(0, 500);
}

export function ConversionDialog({
  model,
  onClose,
  onRefresh,
  onEdit,
  onDiscard,
}: {
  model: ConversionDialogModel;
  onClose(): void;
  onRefresh(): void;
  onEdit(): void;
  onDiscard(): void;
}): React.JSX.Element {
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm" role="dialog" aria-labelledby="conversion-title">
      <div className="flex max-h-[min(760px,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold" id="conversion-title">EARS conversion proposal</h2>
            <p className="mt-1 text-sm text-muted-foreground">Local-only output. Nothing here pushes or applies server state.</p>
          </div>
          <button aria-label="Close conversion" className="rounded-md p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose} type="button"><Icon aria-hidden="true" className="size-4" name="X" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
          <ConversionStatus state={model.state} />
          <div>
            <p className="text-sm font-medium">Scoped requirements</p>
            <p className="mt-1 text-sm text-muted-foreground">{model.requirementIds.join(", ") || "Nothing to convert"}</p>
          </div>
          {model.errors.length > 0 ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" role="alert">
              <p className="font-medium">Validation stopped review</p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {model.errors.slice(0, 20).map((error, index) => <li key={`${error.code}-${index}`}>{error.artifactId ? `${error.artifactId}${error.line ? `:${error.line}` : ""} — ` : ""}{error.code}: {error.message}</li>)}
              </ul>
            </div>
          ) : null}
          {model.state === "awaiting_human" ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex items-start gap-3"><Icon aria-hidden="true" className="mt-0.5 size-5" name="FileDiff" /><div><p className="font-medium">Review the ordinary git/sync diff</p><p className="mt-1 text-sm text-muted-foreground">Approval acknowledges a valid local proposal only. It does not push or apply it.</p></div></div>
              {model.diffError ? (
                <div className="mt-3 rounded-md border border-destructive/40 bg-background p-3" role="alert">
                  <p className="text-sm font-medium text-destructive">Requirement diff unavailable</p>
                  <p className="mt-1 text-sm text-muted-foreground">{model.diffError} Gate results remain current; approval stays unavailable.</p>
                </div>
              ) : null}
              {model.diff === undefined && !model.diffError ? <p className="mt-3 text-sm text-muted-foreground">Loading selected requirement changes…</p> : null}
              {model.diff?.length === 0 ? <p className="mt-3 text-sm text-destructive">No selected requirement diff is available. Refresh gates before approval.</p> : null}
              {model.diff !== undefined && model.diffComplete === false && !model.diffError ? (
                <p className="mt-3 text-sm text-destructive">The selected requirement diff is incomplete. Approval stays unavailable until every scoped requirement is shown.</p>
              ) : null}
              {model.diff?.map((item) => (
                <div className="mt-3 rounded-md border border-border bg-background p-3" key={item.key}>
                  <p className="text-sm font-medium">{item.label} · {item.operation}</p>
                  {item.fields.map((field) => (
                    <div className="mt-2 grid grid-cols-[minmax(7rem,0.4fr)_1fr_1fr] gap-2 text-xs" key={field.field}>
                      <span className="font-medium">{field.field}</span>
                      <code className="break-all rounded bg-muted p-2">Before: {diffValue(field.base)}</code>
                      <code className="break-all rounded bg-muted p-2">Proposal: {diffValue(field.ours)}</code>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
          <button className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted" onClick={onRefresh} type="button">Refresh gates</button>
          <button className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted" onClick={onEdit} type="button">Edit files</button>
          <button className="h-9 rounded-md border border-destructive/40 px-3 text-sm font-medium text-foreground hover:bg-destructive/10" onClick={onDiscard} type="button">Discard</button>
          <div className="flex flex-col items-end gap-1">
            <button aria-describedby="conversion-approval-pending" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled type="button">Approve local proposal</button>
            <p className="max-w-sm text-right text-xs text-muted-foreground" id="conversion-approval-pending">Human approval is pending an owner ruling on the trusted local-review transition.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
