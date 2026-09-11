import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ResourceSortMenu, ResourceToolbar } from "@bb/shared-ui/resource-list";
import {
  PluginBrowseCategoryFilter,
  pluginBrowseSort,
  pluginBrowseSortDirection,
  pluginBrowseSortOptions,
  type PluginBrowseCategoryOption,
} from "./PluginBrowseControls";

interface PluginCollectionToolbarProps {
  categoryOptions: readonly PluginBrowseCategoryOption[];
  hasInstallCounts: boolean;
  action?: ReactNode;
  searchPlaceholder?: string;
  additionalControls?: ReactNode;
}

export function PluginCollectionToolbar({
  categoryOptions,
  hasInstallCounts,
  action,
  searchPlaceholder = "Search plugins",
  additionalControls,
}: PluginCollectionToolbarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSort = pluginBrowseSort(searchParams.get("sort"));
  const sort =
    requestedSort === "most-installed" && !hasInstallCounts
      ? null
      : requestedSort;
  const direction =
    pluginBrowseSortDirection(searchParams.get("direction")) ??
    (sort === "name" ? "asc" : "desc");
  const change = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  };
  return (
    <ResourceToolbar
      compact
      searchValue={searchParams.get("query") ?? ""}
      searchPlaceholder={searchPlaceholder}
      onSearchChange={(value) =>
        change((next) => {
          if (value === "") next.delete("query");
          else next.set("query", value);
        })
      }
      action={action}
      controls={
        <>
          <ResourceSortMenu
            value={sort}
            direction={direction}
            compact
            placeholderLabel="Default"
            options={pluginBrowseSortOptions(hasInstallCounts)}
            onChange={(value) =>
              change((next) => {
                next.set("sort", value);
                next.set(
                  "direction",
                  value === sort
                    ? direction === "desc"
                      ? "asc"
                      : "desc"
                    : value === "name"
                      ? "asc"
                      : "desc",
                );
              })
            }
            onClear={() =>
              change((next) => {
                next.delete("sort");
                next.delete("direction");
              })
            }
          />
          <PluginBrowseCategoryFilter
            compactWhenNarrow
            selectionMode="multiple"
            value={searchParams.getAll("category")}
            options={categoryOptions}
            onChange={(values) =>
              change((next) => {
                next.delete("shelf");
                next.delete("category");
                for (const value of values) next.append("category", value);
              })
            }
          />
          {additionalControls}
        </>
      }
    />
  );
}
