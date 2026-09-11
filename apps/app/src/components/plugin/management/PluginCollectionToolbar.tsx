import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ResourceSortMenu, ResourceToolbar } from "@bb/shared-ui/resource-list";
import type { PluginBrowseSort } from "./plugin-browse-discovery";
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
  defaultSort?: PluginBrowseSort;
}

export function PluginCollectionToolbar({
  categoryOptions,
  hasInstallCounts,
  action,
  searchPlaceholder = "Search plugins",
  additionalControls,
  defaultSort,
}: PluginCollectionToolbarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSort =
    pluginBrowseSort(searchParams.get("sort")) ?? defaultSort ?? null;
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
          <PluginBrowseCategoryFilter
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
          <ResourceSortMenu
            value={sort}
            direction={direction}
            compact
            placeholderLabel="Featured"
            options={pluginBrowseSortOptions(hasInstallCounts)}
            onChange={(value) =>
              change((next) => {
                next.set("sort", value);
                next.set(
                  "direction",
                  value === sort && direction === "desc" ? "asc" : "desc",
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
          {additionalControls}
        </>
      }
    />
  );
}
