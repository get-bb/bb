import { useCallback, useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { WARM_POOLS_CHANGED_CHANNEL } from "./channels.js";
import type { worktreeRpcContract } from "./server.js";
import type { WarmPoolStatus } from "./warm-pools.js";

const SIZE_OPTIONS = ["0", "1", "2", "3", "4"] as const;

function sizeLabel(size: string): string {
  return size === "0" ? "Off" : size;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkoutSummary(
  checkout: WarmPoolStatus["pools"][number]["checkouts"][number],
): string {
  const counts = `${checkout.ready} ready${
    checkout.preparing > 0 ? `, ${checkout.preparing} preparing` : ""
  }${checkout.base === null ? "" : ` at ${checkout.base}`}`;
  return checkout.lastError === null
    ? `${checkout.hostName}: ${counts}`
    : `${checkout.hostName}: ${counts} · ${checkout.lastError}`;
}

export function WarmPoolSettings() {
  const rpc = useRpc<typeof worktreeRpcContract>();
  const [status, setStatus] = useState<WarmPoolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProjectId, setSavingProjectId] = useState<string | null>(null);
  const activeRef = useRef(true);

  const refetch = useCallback(() => {
    rpc.call("warmPoolStatus", {}).then(
      (next) => {
        if (!activeRef.current) return;
        setStatus(next);
        setError(null);
      },
      (fetchError: unknown) => {
        if (activeRef.current) setError(errorMessage(fetchError));
      },
    );
  }, [rpc]);

  useEffect(() => {
    activeRef.current = true;
    refetch();
    return () => {
      activeRef.current = false;
    };
  }, [refetch]);
  useRealtime(WARM_POOLS_CHANGED_CHANNEL, refetch);

  async function setSize(projectId: string, size: number): Promise<void> {
    setSavingProjectId(projectId);
    setError(null);
    try {
      const next = await rpc.call("setWarmPoolSize", { projectId, size });
      if (activeRef.current) setStatus(next);
    } catch (saveError) {
      if (activeRef.current) setError(errorMessage(saveError));
    } finally {
      if (activeRef.current) setSavingProjectId(null);
    }
  }

  return (
    <div className="w-full space-y-3">
      <div className="pr-2">
        <h3 className="text-sm font-medium text-foreground">Warm worktrees</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Keep worktrees checked out at the default base with setup finished, so
          new worktree threads on the default base start without waiting. A warm
          worktree is replaced when the default base moves, and each replacement
          runs the project&apos;s setup script in the background.
        </p>
      </div>
      {status === null ? (
        <p
          className={
            error === null
              ? "text-sm text-muted-foreground"
              : "text-sm text-destructive"
          }
          role={error === null ? "status" : "alert"}
        >
          {error ?? "Loading projects…"}
        </p>
      ) : status.pools.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="ml-2 space-y-1 border-l border-border/60 pl-2">
          {status.pools.map((pool) => (
            <div
              key={pool.projectId}
              className="flex min-h-12 items-center gap-3 rounded-md px-2 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {pool.projectName}
                </div>
                {pool.size > 0
                  ? pool.checkouts.map((checkout) => (
                      <div
                        key={`${checkout.hostId}:${checkout.path}`}
                        className="truncate text-xs text-muted-foreground"
                      >
                        {checkoutSummary(checkout)}
                      </div>
                    ))
                  : null}
              </div>
              <Select
                value={String(pool.size)}
                disabled={savingProjectId === pool.projectId}
                onValueChange={(value) => {
                  void setSize(pool.projectId, Number(value));
                }}
              >
                <SelectTrigger
                  aria-label={`${pool.projectName} warm worktrees`}
                  className="w-24 shrink-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={size}>
                      {sizeLabel(size)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
      {status !== null && error !== null ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
