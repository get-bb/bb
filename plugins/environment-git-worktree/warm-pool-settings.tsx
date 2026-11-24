import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SETTINGS_INLINE_SELECT_CLASS,
  SettingsList,
  SettingsListItem,
  SettingsListMessage,
  type SettingsListMeta,
} from "@bb/shared-ui/settings-section";
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

function folderLabel(folderPath: string): string {
  return folderPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? folderPath;
}

function poolIsOn(pool: Pool): boolean {
  return pool.checkouts.some((checkout) => checkout.size > 0);
}

function checkoutMeta(checkout: Checkout): SettingsListMeta {
  if (checkout.size === 0) return [];
  return [
    `${checkout.ready} ready`,
    checkout.preparing > 0 && `${checkout.preparing} setting up`,
  ];
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
      <SelectTrigger
        aria-label={props.label}
        className={cn(
          SETTINGS_INLINE_SELECT_CLASS,
          props.value === FOLLOW_PROJECT && "text-subtle-foreground",
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
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

function FolderItems(props: {
  pool: Pool;
  branchable: readonly string[];
  onFoldersChange(projectId: string, folders: string[]): void;
}) {
  const { pool, branchable, onFoldersChange } = props;
  return [
    ...branchable,
    ...pool.folders.filter((folder) => !branchable.includes(folder)),
  ].map((folder) => {
    const checked = pool.folders.includes(folder);
    return (
      <SettingsListItem
        key={`folder:${folder}`}
        title={`Also branch ${folderLabel(folder)}`}
        description={folder}
        leading={
          <Checkbox
            aria-label={`${pool.projectName} warm worktrees also branch ${folderLabel(folder)}`}
            checked={checked}
            onCheckedChange={() => {
              onFoldersChange(
                pool.projectId,
                checked
                  ? pool.folders.filter((entry) => entry !== folder)
                  : [...pool.folders, folder],
              );
            }}
          />
        }
      />
    );
  });
}

function PoolItem(props: {
  pool: Pool;
  saving: ReadonlySet<string>;
  branchable: readonly string[];
  onChange(change: WarmPoolSizeChange): void;
  onFoldersChange(projectId: string, folders: string[]): void;
}) {
  const { pool, saving, branchable, onChange, onFoldersChange } = props;
  const single = pool.checkouts.length === 1 ? pool.checkouts[0] : undefined;
  const folderItems =
    poolIsOn(pool) && branchable.length + pool.folders.length > 0 ? (
      <FolderItems
        pool={pool}
        branchable={branchable}
        onFoldersChange={onFoldersChange}
      />
    ) : null;
  return (
    <SettingsListItem
      title={pool.projectName}
      meta={single === undefined ? [] : checkoutMeta(single)}
      error={
        single === undefined || single.size === 0 ? null : single.lastError
      }
      control={
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
      }
    >
      {single === undefined ? (
        <>
          {pool.checkouts.map((checkout) => (
            <SettingsListItem
              key={`${checkout.hostId}:${checkout.path}`}
              title={checkout.hostName}
              meta={checkoutMeta(checkout)}
              error={checkout.size === 0 ? null : checkout.lastError}
              control={
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
                  followProjectLabel={`Project (${sizeLabel(String(pool.size))})`}
                  onChange={(value) => {
                    onChange({
                      projectId: pool.projectId,
                      hostId: checkout.hostId,
                      size: value === FOLLOW_PROJECT ? null : Number(value),
                    });
                  }}
                />
              }
            />
          ))}
          {folderItems}
        </>
      ) : (
        (folderItems ?? undefined)
      )}
    </SettingsListItem>
  );
}

export function WarmPoolSettingsContent(props: {
  status: WarmPoolStatus | null;
  error: string | null;
  saving: ReadonlySet<string>;
  branchableFolders: ReadonlyMap<string, readonly string[]>;
  onChange(change: WarmPoolSizeChange): void;
  onFoldersChange(projectId: string, folders: string[]): void;
}) {
  const {
    status,
    error,
    saving,
    branchableFolders,
    onChange,
    onFoldersChange,
  } = props;
  return (
    <div className="w-full space-y-2">
      <SettingsList label="Warm worktrees" dividers={false}>
        {status === null ? (
          <SettingsListMessage tone={error === null ? "muted" : "error"}>
            {error ?? "Loading projects…"}
          </SettingsListMessage>
        ) : status.pools.length === 0 ? (
          <SettingsListMessage>No projects yet.</SettingsListMessage>
        ) : (
          status.pools.map((pool) => (
            <PoolItem
              key={pool.projectId}
              pool={pool}
              saving={saving}
              branchable={branchableFolders.get(pool.projectId) ?? []}
              onChange={onChange}
              onFoldersChange={onFoldersChange}
            />
          ))
        )}
      </SettingsList>
      {status !== null && error !== null ? (
        <p className="text-xs text-destructive-text" role="alert">
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

  const [branchableFolders, setBranchableFolders] = useState<
    ReadonlyMap<string, readonly string[]>
  >(new Map());
  const activeCheckouts = (status?.pools ?? [])
    .filter(poolIsOn)
    .flatMap((pool) =>
      pool.checkouts.map((checkout) => `${pool.projectId}\0${checkout.hostId}`),
    )
    .join("\n");
  useEffect(() => {
    let active = true;
    const targets = activeCheckouts
      .split("\n")
      .filter(Boolean)
      .map((entry) => {
        const [projectId = "", hostId = ""] = entry.split("\0");
        return { projectId, hostId };
      });
    Promise.all(
      targets.map((target) =>
        rpc.call("listBranchableFolders", target).then(
          (result) => ({
            projectId: target.projectId,
            folders: result.folders,
          }),
          () => ({ projectId: target.projectId, folders: [] }),
        ),
      ),
    ).then((results) => {
      if (!active) return;
      const next = new Map<string, string[]>();
      for (const result of results)
        next.set(result.projectId, [
          ...new Set([
            ...(next.get(result.projectId) ?? []),
            ...result.folders,
          ]),
        ]);
      setBranchableFolders(next);
    });
    return () => {
      active = false;
    };
  }, [activeCheckouts, rpc]);

  async function changeFolders(
    projectId: string,
    folders: string[],
  ): Promise<void> {
    setError(null);
    try {
      const updated = await rpc.call("setWarmPoolFolders", {
        projectId,
        folders,
      });
      if (activeRef.current) setStatus(updated);
    } catch (saveError) {
      if (activeRef.current) setError(errorMessage(saveError));
    }
  }

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
      branchableFolders={branchableFolders}
      onChange={(next) => {
        void change(next);
      }}
      onFoldersChange={(projectId, folders) => {
        void changeFolders(projectId, folders);
      }}
    />
  );
}
