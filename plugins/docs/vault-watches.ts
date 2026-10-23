import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  errorMessage,
  pathTags,
  treeTag,
  vaultTag,
  type Vault,
} from "./contract.js";

export interface VaultWatcher {
  close(): void;
  on(event: "error", listener: () => void): void;
}

export type WatchVault = (
  rootPath: string,
  onChange: (relativePath: string | null) => void,
) => VaultWatcher;

export const watchNativeVault: WatchVault = (rootPath, onChange) => {
  const watcher = watch(rootPath, { recursive: true }, (_event, filename) =>
    onChange(filename === null ? null : String(filename)),
  );
  return {
    close: () => watcher.close(),
    on: (event, listener) => {
      watcher.on(event, listener);
    },
  };
};

type Fingerprint = { size: number; mtimeMs: number } | null;

const OWN_CHANGE_TTL_MS = 5_000;

export interface VaultWatchesOptions {
  getVault(vaultId: string): Vault;
  watchVault: WatchVault;
  invalidate(tags: string[]): void;
  scanRemote(vault: Vault, signal: AbortSignal): Promise<Map<string, number>>;
  onExternalChange(vaultId: string, paths: string[] | null): Promise<boolean>;
  warn(message: string): void;
  pollMs?: number;
  debounceMs?: number;
}

interface ActiveVault {
  vault: Vault;
  clients: number;
  stop(): void;
  ownChanges: Map<string, { fingerprint: Fingerprint; expiresAt: number }>;
  ownSincePoll: Set<string>;
  recording: Promise<unknown>[];
}

function isTreePath(relativePath: string): boolean {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return /\.(md|html?)$/i.test(name) || !name.includes(".");
}

async function fingerprint(filePath: string): Promise<Fingerprint> {
  try {
    const stats = await stat(filePath);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean {
  if (left === null || right === null) return left === right;
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function createVaultWatches(options: VaultWatchesOptions) {
  const pollMs = options.pollMs ?? 10_000;
  const debounceMs = options.debounceMs ?? 50;
  const active = new Map<string, ActiveVault>();

  async function publish(vaultId: string, paths: string[] | null) {
    if (paths?.length === 0) return;
    const treeChanged = await options
      .onExternalChange(vaultId, paths)
      .catch(() => true);
    if (paths === null) {
      options.invalidate([vaultTag(vaultId)]);
      return;
    }
    options.invalidate([
      ...(treeChanged ? [treeTag(vaultId)] : []),
      ...paths.flatMap((relativePath) => pathTags(vaultId, relativePath)),
    ]);
  }

  function watchLocal(entry: ActiveVault): () => void {
    const { vault } = entry;
    const pending = new Set<string>();
    let everything = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = async () => {
      timer = null;
      const paths = [...pending];
      const all = everything;
      pending.clear();
      everything = false;
      await Promise.all(entry.recording.splice(0));
      if (all) {
        await publish(vault.id, null);
        return;
      }
      const now = Date.now();
      const changed: string[] = [];
      for (const relativePath of paths) {
        const own = entry.ownChanges.get(relativePath);
        if (own && own.expiresAt > now) {
          const current = await fingerprint(
            path.join(vault.rootPath, ...relativePath.split("/")),
          );
          if (sameFingerprint(own.fingerprint, current)) continue;
        }
        changed.push(relativePath);
      }
      await publish(vault.id, changed);
    };
    const onChange = (filename: string | null) => {
      if (filename === null) everything = true;
      else {
        const relativePath = filename.replace(/\\/g, "/");
        const segments = relativePath.split("/");
        if (segments.some((segment) => segment.startsWith("."))) return;
        if (!isTreePath(relativePath)) return;
        pending.add(relativePath);
      }
      timer ??= setTimeout(() => void flush(), debounceMs);
    };
    let watcher: VaultWatcher;
    try {
      watcher = options.watchVault(vault.rootPath, onChange);
    } catch (error) {
      options.warn(
        `cannot watch ${vault.rootPath}; using polling: ${errorMessage(error)}`,
      );
      return poll(entry);
    }
    let stopPolling: (() => void) | null = null;
    watcher.on("error", () => {
      watcher.close();
      stopPolling ??= poll(entry);
    });
    return () => {
      if (timer) clearTimeout(timer);
      watcher.close();
      stopPolling?.();
    };
  }

  function poll(entry: ActiveVault): () => void {
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      let previous: Map<string, number> | "offline" | null = null;
      while (!signal.aborted) {
        let next: Map<string, number> | "offline";
        try {
          next = await options.scanRemote(entry.vault, signal);
        } catch {
          next = "offline";
        }
        if (signal.aborted) return;
        const own = new Set(entry.ownSincePoll);
        entry.ownSincePoll.clear();
        if (previous !== null) {
          if (previous === "offline" || next === "offline") {
            if (previous !== next) await publish(entry.vault.id, null);
          } else {
            const changed: string[] = [];
            for (const [relativePath, modified] of next)
              if (previous.get(relativePath) !== modified)
                changed.push(relativePath);
            for (const relativePath of previous.keys())
              if (!next.has(relativePath)) changed.push(relativePath);
            await publish(
              entry.vault.id,
              changed.filter((relativePath) => !own.has(relativePath)),
            );
          }
        }
        previous = next;
        await waitFor(pollMs, signal);
      }
    })();
    return () => controller.abort();
  }

  return {
    retain(vaultId: string, signal: AbortSignal): void {
      if (signal.aborted) return;
      let entry = active.get(vaultId);
      if (!entry) {
        const vault = options.getVault(vaultId);
        const created: ActiveVault = {
          vault,
          clients: 0,
          stop: () => {},
          ownChanges: new Map(),
          ownSincePoll: new Set(),
          recording: [],
        };
        created.stop = vault.hostId ? poll(created) : watchLocal(created);
        active.set(vaultId, created);
        entry = created;
      }
      const retained = entry;
      retained.clients += 1;
      signal.addEventListener(
        "abort",
        () => {
          retained.clients -= 1;
          if (retained.clients > 0 || active.get(vaultId) !== retained) return;
          active.delete(vaultId);
          retained.stop();
        },
        { once: true },
      );
    },
    recordOwnChange(vault: Vault, relativePaths: string[]): void {
      const entry = active.get(vault.id);
      if (!entry) return;
      const now = Date.now();
      for (const [relativePath, own] of entry.ownChanges)
        if (own.expiresAt <= now) entry.ownChanges.delete(relativePath);
      if (vault.hostId) {
        for (const relativePath of relativePaths)
          entry.ownSincePoll.add(relativePath);
        return;
      }
      entry.recording.push(
        Promise.all(
          relativePaths.map(async (relativePath) => {
            entry.ownChanges.set(relativePath, {
              fingerprint: await fingerprint(
                path.join(vault.rootPath, ...relativePath.split("/")),
              ),
              expiresAt: Date.now() + OWN_CHANGE_TTL_MS,
            });
          }),
        ),
      );
    },
    stopAll(): void {
      for (const entry of active.values()) entry.stop();
      active.clear();
    },
  };
}
