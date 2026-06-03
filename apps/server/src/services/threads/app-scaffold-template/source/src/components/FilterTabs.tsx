import type { FilterTabsProps, TodoFilter } from "../types";

const filters: TodoFilter[] = ["all", "open", "done"];

function labelForFilter(filter: TodoFilter): string {
  if (filter === "open") {
    return "Open";
  }
  if (filter === "done") {
    return "Done";
  }
  return "All";
}

function countForFilter(props: FilterTabsProps, filter: TodoFilter): number {
  if (filter === "open") {
    return props.stats.open;
  }
  if (filter === "done") {
    return props.stats.done;
  }
  return props.stats.total;
}

export function FilterTabs(props: FilterTabsProps) {
  return (
    <div className="filter-tabs" role="tablist" aria-label="Todo filters">
      {filters.map((filter) => (
        <button
          key={filter}
          className={
            props.activeFilter === filter ? "filter-tab active" : "filter-tab"
          }
          type="button"
          role="tab"
          aria-selected={props.activeFilter === filter}
          onClick={() => props.onChange(filter)}
        >
          <span>{labelForFilter(filter)}</span>
          <span className="filter-count">{countForFilter(props, filter)}</span>
        </button>
      ))}
    </div>
  );
}
