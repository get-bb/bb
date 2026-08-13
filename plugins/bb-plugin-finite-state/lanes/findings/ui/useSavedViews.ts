import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@bb/plugin-sdk/app";
import type { findingsUiRpcContract } from "../rpc.js";
import { FINDING_COLUMNS } from "./columns.js";
import { filterSnapshot, type FindingsFilter, type SavedFindingView } from "./route.js";

const DEFAULT_SORT = [{ field: "risk", direction: "desc" as const }];
const DEFAULT_COLUMNS = [...FINDING_COLUMNS];

export const BUILT_IN_FINDING_VIEWS: readonly SavedFindingView[] = [
  {
    schema: "fs-findings-view/v1",
    id: "untriaged-by-risk",
    name: "Untriaged by risk",
    filter: { triage: ["unknown"] },
    sort: DEFAULT_SORT,
    columns: DEFAULT_COLUMNS,
    builtIn: true,
  },
  {
    schema: "fs-findings-view/v1",
    id: "local-changes",
    name: "Local changes",
    filter: { localState: ["local", "conflicted", "stale", "needs_completion"] },
    sort: DEFAULT_SORT,
    columns: DEFAULT_COLUMNS,
    builtIn: true,
  },
  {
    schema: "fs-findings-view/v1",
    id: "needs-attention",
    name: "Needs attention",
    filter: { localState: ["conflicted", "needs_completion"] },
    sort: DEFAULT_SORT,
    columns: DEFAULT_COLUMNS,
    builtIn: true,
  },
];

interface SavedViewsState {
  views: SavedFindingView[];
  loading: boolean;
  error: string | null;
  recoveredFromCorrupt: boolean;
  create(name: string, filter: FindingsFilter, columns: readonly string[]): Promise<SavedFindingView | null>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  refresh(): Promise<void>;
}

export function useSavedViews(projectId: string | null): SavedViewsState {
  const rpc = useRpc<typeof findingsUiRpcContract>();
  const [userViews, setUserViews] = useState<SavedFindingView[]>([]);
  const [sha256, setSha256] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const [recoveredFromCorrupt, setRecovered] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setUserViews([]);
      setSha256(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await rpc.call("findingsSavedViewsGet", { projectId });
      setUserViews(result.views);
      setSha256(result.sha256);
      setRecovered(result.recoveredFromCorrupt);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved views could not be read.");
    } finally {
      setLoading(false);
    }
  }, [projectId, rpc]);

  useEffect(() => { void refresh(); }, [refresh]);

  const persist = useCallback(async (views: SavedFindingView[]) => {
    if (!projectId) return;
    const result = await rpc.call("findingsSavedViewsPut", {
      projectId,
      expectedSha256: sha256,
      views: views.map(({ builtIn: _builtIn, ...view }) => ({
        ...view,
        sort: [{ field: "risk" as const, direction: "desc" as const }],
      })),
    });
    setUserViews(result.views);
    setSha256(result.sha256);
    setRecovered(false);
    setError(null);
  }, [projectId, rpc, sha256]);

  const create = useCallback(async (name: string, filter: FindingsFilter, columns: readonly string[]) => {
    const normalizedName = name.trim().slice(0, 100);
    if (!normalizedName) return null;
    const view: SavedFindingView = {
      schema: "fs-findings-view/v1",
      id: `user-${crypto.randomUUID()}`,
      name: normalizedName,
      filter: filterSnapshot(filter),
      sort: DEFAULT_SORT,
      columns: columns.length > 0 ? [...columns] : DEFAULT_COLUMNS,
    };
    try { await persist([...userViews, view]); return view; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The view could not be saved."); return null; }
  }, [persist, userViews]);

  const rename = useCallback(async (id: string, name: string) => {
    const normalizedName = name.trim().slice(0, 100);
    if (!normalizedName) return;
    try { await persist(userViews.map(view => view.id === id ? { ...view, name: normalizedName } : view)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The view could not be renamed."); }
  }, [persist, userViews]);

  const remove = useCallback(async (id: string) => {
    try { await persist(userViews.filter(view => view.id !== id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The view could not be deleted."); }
  }, [persist, userViews]);

  const views = useMemo(() => [...BUILT_IN_FINDING_VIEWS, ...userViews], [userViews]);
  return { views, loading, error, recoveredFromCorrupt, create, rename, remove, refresh };
}
