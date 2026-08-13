import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { VexStatus } from "../../../../lib/remote/types.js";
import { VEX_SHORTCUTS } from "./validation.js";

export interface BulkFailure {
  findingId: string;
  stableKey: string;
  message: string;
  retryable: boolean;
}

const STATUS_BUTTONS = Object.entries(VEX_SHORTCUTS) as Array<[keyof typeof VEX_SHORTCUTS, VexStatus]>;

export function BulkDecisionBar({ count, predicate, sharedCollisionRows, existingDecisionCount, open, confirming, pending, status, failures, onOpen, onStatus, onConfirm, onRetry, onCancel }: {
  count: number;
  predicate: boolean;
  sharedCollisionRows: number;
  existingDecisionCount: number;
  open: boolean;
  confirming: boolean;
  pending: boolean;
  status: VexStatus | null;
  failures: readonly BulkFailure[];
  onOpen(): void;
  onStatus(status: VexStatus): void;
  onConfirm(): void;
  onRetry(): void;
  onCancel(): void;
}): React.JSX.Element | null {
  if (!open && count === 0) return null;
  return (
    <section aria-label={`Bulk decision controls for ${count} selected findings`} className="border-t border-primary/30 bg-card px-4 py-3 shadow-[0_-8px_24px_color-mix(in_oklab,var(--ink)_8%,transparent)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-44 items-center gap-2"><Icon aria-hidden="true" className="size-4 text-primary" name="ListTodo" /><div><p className="text-sm font-semibold">{count.toLocaleString()} selected</p><p className="text-xs text-muted-foreground">{predicate ? "Filter predicate · unloaded rows included" : "Explicit exact-row set"}</p></div></div>
        {!open ? <Button onClick={onOpen} size="sm">Set status…</Button> : (
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {STATUS_BUTTONS.map(([key, value]) => <Button aria-keyshortcuts={key === "R" ? "Shift+R" : key} aria-pressed={status === value} key={key} onClick={() => onStatus(value)} size="sm" variant={status === value ? "secondary" : "outline"}><kbd className="mr-1 font-mono">{key}</kbd>{value.replaceAll("_", " ")}</Button>)}
          </div>
        )}
        {confirming && status ? <div className="ml-auto flex items-center gap-2"><span className="text-xs text-muted-foreground">Preview: write {status.replaceAll("_", " ")} to {count.toLocaleString()} local decision{count === 1 ? "" : "s"}?</span><Button disabled={pending} onClick={onConfirm} size="sm">{pending ? "Writing…" : "Confirm local writes"}</Button><Button disabled={pending} onClick={onCancel} size="sm" variant="ghost">Cancel</Button></div> : null}
      </div>
      {sharedCollisionRows > 0 ? <p className="mt-2 text-xs text-muted-foreground">{sharedCollisionRows.toLocaleString()} additional rendered collision {sharedCollisionRows === 1 ? "row shares" : "rows share"} the selected local overlay identity. One YAML entry is written per shared identity, using one exact finding row.</p> : null}
      {existingDecisionCount > 0 ? <p className="mt-2 text-xs text-warning">{existingDecisionCount.toLocaleString()} existing local {existingDecisionCount === 1 ? "decision will" : "decisions will"} be replaced by this confirmed bulk write.</p> : null}
      {failures.length > 0 ? <div className="mt-3 rounded-md border border-destructive/40 bg-muted p-3 text-xs" role="alert"><div className="flex items-center justify-between gap-3"><p className="font-medium">{failures.length} decision{failures.length === 1 ? "" : "s"} failed; successful YAML changes were kept.</p><Button disabled={pending || !failures.some(failure => failure.retryable)} onClick={onRetry} size="sm" variant="outline">Retry failed</Button></div><ul className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-muted-foreground">{failures.map(failure => <li key={`${failure.findingId}:${failure.message}`}>{failure.stableKey}: {failure.message}</li>)}</ul></div> : null}
    </section>
  );
}
