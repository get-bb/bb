import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  PluginBrowseSort,
  PluginBrowseSortDirection,
} from "./plugin-browse-discovery";

export function usePluginCollectionParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const rawSort = searchParams.get("sort");
  const requestedSort: PluginBrowseSort | null =
    rawSort === "name" ||
    rawSort === "recently-added" ||
    rawSort === "most-installed"
      ? rawSort
      : null;
  const rawDirection = searchParams.get("direction");
  const sortDirection: PluginBrowseSortDirection =
    rawDirection === "asc" || rawDirection === "desc"
      ? rawDirection
      : requestedSort === "name"
        ? "asc"
        : "desc";
  const selectedCategories = useMemo(
    () =>
      searchParams.get("shelf")?.startsWith("category:")
        ? []
        : searchParams.getAll("category"),
    [searchParams],
  );
  const changeSearchParams = useCallback(
    (change: (next: URLSearchParams) => void, replace = true) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          change(next);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );
  return {
    searchParams,
    query,
    requestedSort,
    sortDirection,
    selectedCategories,
    changeSearchParams,
  };
}
