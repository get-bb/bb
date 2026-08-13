import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { z } from "zod";
import type { rpcContract } from "../../../shared/contract.js";

export type SyncPushReport = z.output<
  (typeof rpcContract)["syncPush"]["output"]
>;

const RESULT_STYLES: Readonly<Record<SyncPushReport["items"][number]["status"], string>> = {
  applied: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  skipped: "border-border bg-muted text-muted-foreground",
};

function retryableFailureKeys(report: SyncPushReport): string[] {
  return [
    ...new Set(
      report.items
        .filter(
          (item) =>
            item.status === "failed" && item.error?.retryable === true,
        )
        .map((item) => item.key),
    ),
  ];
}

export interface PushResultsProps {
  report: SyncPushReport;
  retrying: boolean;
  authorizationAvailable: boolean;
  retryError: string | null;
  onRetry(keys: string[]): Promise<void>;
}

export function PushResults({
  report,
  retrying,
  authorizationAvailable,
  retryError,
  onRetry,
}: PushResultsProps): React.JSX.Element {
  const retryableKeys = retryableFailureKeys(report);
  return (
    <section
      aria-labelledby="push-results-title"
      className="border-b border-border bg-card"
    >
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            PUSH RUN {report.runId}
          </p>
          <h2 className="mt-1 text-base font-semibold" id="push-results-title">
            {report.status === "completed"
              ? "Push completed"
              : report.status === "partial"
                ? "Push completed with partial results"
                : "Push failed"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            {report.summary.applied} applied · {report.summary.failed} failed · {report.summary.skipped} skipped
            {report.requiresPull ? " · Pull required before continuing" : ""}
          </p>
        </div>
        {retryableKeys.length > 0 ? (
          <div className="text-right">
            <Button
              disabled={!authorizationAvailable || retrying}
              onClick={() => void onRetry(retryableKeys)}
              size="sm"
              variant="outline"
            >
              <Icon
                aria-hidden="true"
                className={retrying ? "animate-spin" : undefined}
                name="RotateCcw"
              />
              Retry {retryableKeys.length} eligible {retryableKeys.length === 1 ? "failure" : "failures"}
            </Button>
            {!authorizationAvailable ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Human retry approval is unavailable in v1.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {retryError ? (
        <p className="border-b border-border px-4 py-2 text-sm text-destructive" role="alert">
          {retryError}
        </p>
      ) : null}
      <ul aria-label="Per-item push results" className="max-h-72 overflow-auto">
        {report.items.map((item) => (
          <li
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0"
            key={`${item.kind}\0${item.key}`}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.kind}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {item.key}
              </p>
              {item.error ? (
                <p className="mt-1 text-xs text-destructive">
                  {item.error.code}: {item.error.message}
                  {item.error.retryable ? " · Retryable" : " · Not retryable"}
                </p>
              ) : null}
            </div>
            <Badge className={RESULT_STYLES[item.status]} variant="outline">
              {item.status}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="sr-only" aria-live="assertive">
        Push {report.status}. {report.summary.applied} applied, {report.summary.failed} failed, {report.summary.skipped} skipped.
      </div>
    </section>
  );
}
