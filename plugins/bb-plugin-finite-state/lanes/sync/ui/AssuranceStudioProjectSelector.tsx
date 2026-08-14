import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export interface AssuranceStudioProjectOption {
  assuranceStudioProjectId: string;
  assuranceStudioProjectName: string;
  platformProjectVersionName: string | null;
  syncStatus: string;
  isPrimary: boolean;
}

export function AssuranceStudioProjectSelector({
  candidateState,
  candidates,
  error,
  loading,
  onRetry,
  onSelect,
  saving,
  selectedId,
}: {
  candidateState: "ambiguous" | "none" | "unambiguous";
  candidates: AssuranceStudioProjectOption[];
  error: string | null;
  loading: boolean;
  onRetry(): void;
  onSelect(projectId: string): Promise<void>;
  saving: boolean;
  selectedId: string | null;
}): React.JSX.Element {
  const [pendingId, setPendingId] = useState(selectedId ?? "");

  return (
    <section
      aria-label="Assurance Studio project mapping"
      className="border-b border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Assurance Studio project</p>
            {selectedId ? <Badge variant="outline">Selected</Badge> : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Choose the product-linked project used for connected TARA reads.
            This selection is explicit; primary and sync status never choose it
            automatically.
          </p>
          <select
            aria-label="Assurance Studio project"
            className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            disabled={loading || saving || candidates.length === 0}
            onChange={(event) => setPendingId(event.target.value)}
            value={pendingId}
          >
            <option value="">Select a linked project</option>
            {candidates.map((candidate) => (
              <option
                key={candidate.assuranceStudioProjectId}
                value={candidate.assuranceStudioProjectId}
              >
                {candidate.assuranceStudioProjectName} · {candidate.syncStatus}
                {candidate.platformProjectVersionName
                  ? ` · ${candidate.platformProjectVersionName}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
        <Button
          disabled={
            loading ||
            saving ||
            pendingId.length === 0 ||
            pendingId === selectedId
          }
          onClick={() => void onSelect(pendingId)}
          size="sm"
          type="button"
        >
          {saving ? (
            <Icon
              aria-hidden="true"
              className="animate-spin"
              name="RotateCcw"
            />
          ) : null}
          Save selection
        </Button>
      </div>
      {loading ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Enumerating product-linked projects…
        </p>
      ) : candidates.length === 0 && !error ? (
        <Alert className="mt-3">
          <AlertTitle>No linked Assurance Studio projects</AlertTitle>
          <AlertDescription>
            The Assurance Studio tenant did not report a project linked to this
            Platform project. No fallback match was attempted.
          </AlertDescription>
        </Alert>
      ) : null}
      {candidateState === "ambiguous" ? (
        <p className="mt-2 text-xs text-warning">
          {candidates.length} linked projects require an explicit choice.
        </p>
      ) : candidateState === "unambiguous" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          1 linked project is available. Confirm it explicitly before connected
          reads.
        </p>
      ) : null}
      {error ? (
        <Alert className="mt-3" variant="destructive">
          <AlertTitle>Project mapping could not be loaded</AlertTitle>
          <AlertDescription>
            {error}
            <Button
              className="ml-2"
              onClick={onRetry}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
