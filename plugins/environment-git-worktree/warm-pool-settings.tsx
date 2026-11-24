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
const FOLLOW_PROJECT = "project";

function sizeLabel(size: string): string {
  return size === "0" ? "Off" : size;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Pool = WarmPoolStatus["pools"][number];
type Checkout = Pool["checkouts"][number];

export type WarmPoolSizeChange =
  | { projectId: string; hostId: null; size: number }
  | { projectId: string; hostId: string; size: number | null };

function changeKey(change: Pick<WarmPoolSizeChange, "projectId" | "hostId">) {
  return `${change.projectId}\0${change.hostId ?? ""}`;
}

function checkoutSummary(checkout: Checkout): string {
  const counts =
    checkout.preparing > 0
      ? `${checkout.ready} ready, ${checkout.preparing} being set up`
      : `${checkout.ready} ready`;
  return checkout.base === null ? counts : `${counts} on ${checkout.base}`;
}

function CheckoutStatus({ checkout }: { checkout: Checkout }) {
  if (checkout.size === 0) return null;
  return (
    <div className="text-xs break-words">
      <div className="text-muted-foreground">{checkoutSummary(checkout)}</div>
      {checkout.lastError === null ? null : (
        <div className="text-destructive">{checkout.lastError}</div>
      )}
    </div>
  );
}

function SizeSelect(props: {
  label: string;
  value: string;
  disabled: boolean;
  followProjectLabel: string | null;
  onChange(value: string): void;
}) {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={props.onChange}
    >
      <SelectTrigger aria-label={props.label} className="w-36 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.followProjectLabel === null ? null : (
          <SelectItem value={FOLLOW_PROJECT}>
            {props.followProjectLabel}
          </SelectItem>
        )}
        {SIZE_OPTIONS.map((size) => (
          <SelectItem key={size} value={size}>
            {sizeLabel(size)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PoolRow(props: {
  pool: Pool;
  saving: ReadonlySet<string>;
  onChange(change: WarmPoolSizeChange): void;
}) {
  const { pool, saving, onChange } = props;
  const perMachine = pool.checkouts.length > 1;
  const projectSize = sizeLabel(String(pool.size));
  return (
    <div className="rounded-md px-2 py-2">
      <div className="flex min-h-8 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {pool.projectName}
          </div>
          {perMachine ? (
            <div className="text-xs text-muted-foreground">
              {`${pool.checkouts.length} machines. Each keeps the project's count unless set below.`}
            </div>
          ) : (
            pool.checkouts.map((checkout) => (
              <CheckoutStatus
                key={`${checkout.hostId}:${checkout.path}`}
                checkout={checkout}
              />
            ))
          )}
        </div>
        <SizeSelect
          label={`${pool.projectName} warm worktrees`}
          value={String(pool.size)}
          disabled={saving.has(
            changeKey({ projectId: pool.projectId, hostId: null }),
          )}
          followProjectLabel={null}
          onChange={(value) => {
            onChange({
              projectId: pool.projectId,
              hostId: null,
              size: Number(value),
            });
          }}
        />
      </div>
      {perMachine ? (
        <div className="mt-2 space-y-1 border-l border-border/60 pl-3">
          {pool.checkouts.map((checkout) => (
            <div
              key={`${checkout.hostId}:${checkout.path}`}
              className="flex min-h-10 items-center gap-3 py-1"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-sm text-foreground">
                    {checkout.hostName}
                  </span>
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={checkout.path}
                  >
                    {checkout.path}
                  </span>
                </div>
                <CheckoutStatus checkout={checkout} />
              </div>
              <SizeSelect
                label={`${pool.projectName} warm worktrees on ${checkout.hostName}`}
                value={
                  checkout.hostSize === null
                    ? FOLLOW_PROJECT
                    : String(checkout.hostSize)
                }
                disabled={saving.has(
                  changeKey({
                    projectId: pool.projectId,
                    hostId: checkout.hostId,
                  }),
                )}
                followProjectLabel={`Project (${projectSize})`}
                onChange={(value) => {
                  onChange({
                    projectId: pool.projectId,
                    hostId: checkout.hostId,
                    size: value === FOLLOW_PROJECT ? null : Number(value),
                  });
                }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WarmPoolSettingsContent(props: {
  status: WarmPoolStatus | null;
  error: string | null;
  saving: ReadonlySet<string>;
  onChange(change: WarmPoolSizeChange): void;
}) {
  const { status, error, saving, onChange } = props;
  return (
    <div className="w-full space-y-3">
      <div className="pr-2">
        <h3 className="text-sm font-medium text-foreground">Warm worktrees</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Set up worktrees ahead of time so new worktree threads on the default
          branch start right away. If the branch has moved on, the worktree is
          updated and setup runs again before the thread starts. A project
          checked out on several machines can keep a different count on each.
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
            <PoolRow
              key={pool.projectId}
              pool={pool}
              saving={saving}
              onChange={onChange}
            />
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

export function WarmPoolSettings() {
  const rpc = useRpc<typeof worktreeRpcContract>();
  const [status, setStatus] = useState<WarmPoolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
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

  async function change(next: WarmPoolSizeChange): Promise<void> {
    const key = changeKey(next);
    setSaving((current) => new Set(current).add(key));
    setError(null);
    try {
      const updated =
        next.hostId === null
          ? await rpc.call("setWarmPoolSize", {
              projectId: next.projectId,
              size: next.size,
            })
          : await rpc.call("setWarmPoolHostSize", {
              projectId: next.projectId,
              hostId: next.hostId,
              size: next.size,
            });
      if (activeRef.current) setStatus(updated);
    } catch (saveError) {
      if (activeRef.current) setError(errorMessage(saveError));
    } finally {
      if (activeRef.current)
        setSaving((current) => {
          const remaining = new Set(current);
          remaining.delete(key);
          return remaining;
        });
    }
  }

  return (
    <WarmPoolSettingsContent
      status={status}
      error={error}
      saving={saving}
      onChange={(next) => {
        void change(next);
      }}
    />
  );
}
