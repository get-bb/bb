import { useMemo } from "react";
import { useHosts } from "../hosts/host-queries";
import { useSidebarBootstrap } from "./sidebar-bootstrap";
import { buildSidebarModel, type SidebarModel } from "./sidebar-model";
import type {
  SidebarOrganizeMode,
  SidebarSortMode,
} from "./sidebar-preferences";

export interface UseSidebarModelArgs {
  organize: SidebarOrganizeMode;
  sort: SidebarSortMode;
  draftThreadIds?: ReadonlySet<string>;
}

export interface UseSidebarModelResult {
  model: SidebarModel;
  /** Loading state of the underlying bootstrap query. */
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * The sidebar bootstrap grouped and sorted for rendering. Machine mode also
 * needs the host list for labels/order; the query stays mounted in every
 * mode so switching is instant.
 */
export function useSidebarModel({
  organize,
  sort,
  draftThreadIds,
}: UseSidebarModelArgs): UseSidebarModelResult {
  const bootstrap = useSidebarBootstrap();
  const hosts = useHosts();
  const model = useMemo(
    () =>
      buildSidebarModel({
        bootstrap: bootstrap.data,
        hosts: hosts.data,
        organize,
        sort,
        draftThreadIds,
      }),
    [bootstrap.data, hosts.data, organize, sort, draftThreadIds],
  );
  return {
    model,
    isLoading: bootstrap.isLoading,
    isError: bootstrap.isError,
    error: bootstrap.error,
    refetch: () => {
      void bootstrap.refetch();
    },
  };
}
