import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { EmptyState } from "@bb/shared-ui/empty-state";
import type { RepoStatusOutput } from "../contract.js";

export function UncommittedCard({
  status,
  onClose,
}: {
  status: RepoStatusOutput | null;
  onClose: () => void;
}) {
  const dirty = status?.dirty ?? null;
  const rows: Array<{ label: string; value: number }> = dirty
    ? [
        { label: "Staged", value: dirty.staged },
        { label: "Unstaged", value: dirty.unstaged },
        { label: "Untracked", value: dirty.untracked },
        { label: "Conflicted", value: dirty.conflicted },
      ]
    : [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Uncommitted changes</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Working copy of{" "}
            {status === null ? "this repository" : "this repository"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={onClose}
          aria-label="Close uncommitted changes"
        >
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {dirty === null ? (
          <EmptyState message="No uncommitted change summary available." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={dirty.conflicted > 0 ? "destructive" : "outline"}
                className="font-normal"
              >
                {dirty.total}
                {dirty.truncated ? "+" : ""} changed
              </Badge>
              {dirty.truncated ? (
                <span className="text-xs text-muted-foreground">
                  list truncated
                </span>
              ) : null}
            </div>
            <dl className="mt-3 space-y-1.5 text-xs">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-2"
                >
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
              Git Graph is read-only. Use the repository&apos;s Git tooling to
              inspect, stage, or commit these changes.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
