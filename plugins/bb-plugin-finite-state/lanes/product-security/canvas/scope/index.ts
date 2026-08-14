import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { taraScopeRpcContract } from "./backend.js";

type ScopeResult = z.output<
  (typeof taraScopeRpcContract)["taraScopeResolve"]["output"]
>;
type Version = ScopeResult["versions"][number];
const EMPTY_VERSIONS: readonly Version[] = [];

const VERSION_SCOPE_STORAGE_PREFIX =
  "finite-state:product-security:tara-version:v1:";

export interface ResolvedTaraScope {
  workspaceProjectId: string;
  platformProjectId: string;
  projectVersionId: string | null;
  mode: "version" | "local";
}

interface StoredSelection {
  platformProjectId: string;
  projectVersionId: string;
}

function storageKey(workspaceProjectId: string): string {
  return `${VERSION_SCOPE_STORAGE_PREFIX}${workspaceProjectId}`;
}

function readSelection(workspaceProjectId: string): StoredSelection | null {
  try {
    const encoded = localStorage.getItem(storageKey(workspaceProjectId));
    if (!encoded) return null;
    const decoded: unknown = JSON.parse(encoded);
    if (typeof decoded !== "object" || decoded === null) return null;
    const platformProjectId = Reflect.get(decoded, "platformProjectId");
    const projectVersionId = Reflect.get(decoded, "projectVersionId");
    return typeof platformProjectId === "string" &&
      platformProjectId.length > 0 &&
      typeof projectVersionId === "string" &&
      projectVersionId.length > 0
      ? { platformProjectId, projectVersionId }
      : null;
  } catch {
    return null;
  }
}

function writeSelection(
  workspaceProjectId: string,
  selection: StoredSelection | null,
): void {
  try {
    if (selection) {
      localStorage.setItem(
        storageKey(workspaceProjectId),
        JSON.stringify(selection),
      );
    } else {
      localStorage.removeItem(storageKey(workspaceProjectId));
    }
  } catch {
    // The in-memory selection remains valid for this mount.
  }
}

export function taraScopeVersionKey(selection: StoredSelection | null): string {
  return selection
    ? `${selection.platformProjectId}\0${selection.projectVersionId}`
    : "default";
}

interface StoredResult {
  requestKey: string;
  result: ScopeResult;
}

export interface TaraScopeState {
  status: "unconfigured" | "loading" | "ready" | "error";
  scope: ResolvedTaraScope | null;
  versions: readonly Version[];
  selectedKey: string;
  legacy: ScopeResult["legacy"];
  promotionMessage: string | null;
  promoting: boolean;
  error: string | null;
  select(key: string): void;
  promote(projectVersionId: string): Promise<void>;
  retry(): void;
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "The accepted TARA version could not be resolved.";
}

export function useResolvedTaraScope(
  workspaceProjectId: string | null,
): TaraScopeState {
  const rpc = useRpc<typeof taraScopeRpcContract>();
  const persistedExplicit = useMemo(
    () => (workspaceProjectId ? readSelection(workspaceProjectId) : null),
    [workspaceProjectId],
  );
  const [selectionOverride, setSelectionOverride] = useState<{
    workspaceProjectId: string | null;
    explicit: StoredSelection | null;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [promoting, setPromoting] = useState(false);
  const [promotionMessage, setPromotionMessage] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredResult | null>(null);
  const [failed, setFailed] = useState<{
    requestKey: string;
    message: string;
  } | null>(null);

  const explicit =
    selectionOverride?.workspaceProjectId === workspaceProjectId
      ? selectionOverride.explicit
      : persistedExplicit;

  const requestKey = workspaceProjectId
    ? `${workspaceProjectId}\0${taraScopeVersionKey(explicit)}\0${revision}`
    : "unconfigured";
  useEffect(() => {
    if (!workspaceProjectId) return;
    let active = true;
    void rpc
      .call("taraScopeResolve", {
        workspaceProjectId,
        explicit,
      })
      .then((result) => {
        if (!active) return;
        if (explicit && result.source !== "explicit") {
          writeSelection(workspaceProjectId, null);
          setSelectionOverride({ workspaceProjectId, explicit: null });
        }
        setStored({ requestKey, result });
        setFailed(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFailed({ requestKey, message: safeError(error) });
      });
    return () => {
      active = false;
    };
  }, [explicit, requestKey, rpc, workspaceProjectId]);

  const current = stored?.requestKey === requestKey ? stored.result : null;
  const error = failed?.requestKey === requestKey ? failed.message : null;
  useRealtime("tara:changed", (payload) => {
    if (!workspaceProjectId) return;
    const publishedProjectId =
      typeof payload === "object" && payload !== null
        ? Reflect.get(payload, "projectId")
        : null;
    const currentPlatformProjectId =
      current?.selected?.platformProjectId ?? explicit?.platformProjectId;
    if (
      !currentPlatformProjectId ||
      publishedProjectId === currentPlatformProjectId
    ) {
      setRevision((value) => value + 1);
    }
  });
  const versions = useMemo(
    () => current?.versions ?? EMPTY_VERSIONS,
    [current?.versions],
  );
  const selected = current?.selected ?? null;
  const scope = useMemo(
    () =>
      workspaceProjectId && current
        ? selected
          ? {
              workspaceProjectId,
              platformProjectId: selected.platformProjectId,
              projectVersionId: selected.projectVersionId,
              mode: "version" as const,
            }
          : {
              workspaceProjectId,
              platformProjectId: workspaceProjectId,
              projectVersionId: null,
              mode: "local" as const,
            }
        : null,
    [current, selected, workspaceProjectId],
  );
  const select = useCallback(
    (key: string) => {
      if (!workspaceProjectId) return;
      const next = versions.find(
        (version) => taraScopeVersionKey(version) === key,
      );
      if (!next) return;
      const selection = {
        platformProjectId: next.platformProjectId,
        projectVersionId: next.projectVersionId,
      };
      writeSelection(workspaceProjectId, selection);
      setSelectionOverride({ workspaceProjectId, explicit: selection });
    },
    [versions, workspaceProjectId],
  );
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const promote = useCallback(
    async (projectVersionId: string) => {
      if (!workspaceProjectId || !current?.legacy) return;
      setPromoting(true);
      setPromotionMessage(null);
      try {
        const result = await rpc.call("taraScopePromote", {
          workspaceProjectId,
          platformProjectId: current.legacy.platformProjectId,
          projectVersionId,
        });
        const next = {
          platformProjectId: result.selected.platformProjectId,
          projectVersionId: result.selected.projectVersionId,
        };
        writeSelection(workspaceProjectId, next);
        setSelectionOverride({ workspaceProjectId, explicit: next });
        setPromotionMessage(
          `Promoted the complete legacy snapshot: ${result.promotedKinds.join(", ")}.`,
        );
        setRevision((value) => value + 1);
      } catch (promotionError) {
        setFailed({ requestKey, message: safeError(promotionError) });
      } finally {
        setPromoting(false);
      }
    },
    [current?.legacy, requestKey, rpc, workspaceProjectId],
  );
  return {
    status: !workspaceProjectId
      ? "unconfigured"
      : scope
        ? "ready"
        : error
          ? "error"
          : current
            ? "unconfigured"
            : "loading",
    scope,
    versions,
    selectedKey: selected ? taraScopeVersionKey(selected) : "",
    legacy: current?.legacy ?? null,
    promotionMessage,
    promoting,
    error,
    select,
    promote,
    retry,
  };
}
