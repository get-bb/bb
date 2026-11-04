import { useMemo } from "react";
import type { Environment } from "@bb/domain";
import type {
  MarkdownRelativeLinkHealing,
  MarkdownRelativeLinkRoot,
} from "@/components/ui/markdown-link-routing";
import { useSystemConfig } from "@/hooks/queries/system-queries";

interface ThreadStorageRoot {
  hostId: string;
  rootPath: string;
}

interface UseThreadRelativeLinkHealingArgs {
  environment: Environment | null | undefined;
  threadStorage: ThreadStorageRoot | null;
}

export function useThreadRelativeLinkHealing({
  environment,
  threadStorage,
}: UseThreadRelativeLinkHealingArgs): MarkdownRelativeLinkHealing | null {
  const enabled = useSystemConfig().data?.experiments.resolveFileLinks === true;
  const environmentHostId = environment?.hostId ?? null;
  const workspaceRootPath = environment?.path ?? null;
  const storageHostId = threadStorage?.hostId ?? null;
  const storageRootPath = threadStorage?.rootPath ?? null;
  return useMemo(() => {
    if (!enabled) return null;
    const roots: MarkdownRelativeLinkRoot[] = [];
    if (environmentHostId !== null && workspaceRootPath !== null) {
      roots.push({ hostId: environmentHostId, rootPath: workspaceRootPath });
    }
    if (storageHostId !== null && storageRootPath !== null) {
      roots.push({ hostId: storageHostId, rootPath: storageRootPath });
    }
    return roots.length === 0 ? null : { roots };
  }, [
    enabled,
    environmentHostId,
    storageHostId,
    storageRootPath,
    workspaceRootPath,
  ]);
}
