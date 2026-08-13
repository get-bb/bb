import { useEffect, useRef } from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Icon } from "@bb/shared-ui/icon";

export type FilterBoolean = "all" | "yes" | "no";
export type FilterSeverity = "" | "critical" | "high" | "medium" | "low";
export type FilterReachability = "" | "reachable" | "unreachable" | "mixed" | "unknown";
export type FilterSort = "name" | "severity" | "kev" | "license";

export interface SbomFiltersValue {
  search: string;
  severity: FilterSeverity;
  kev: FilterBoolean;
  reachability: FilterReachability;
  license: string;
  source: string;
  linked: FilterBoolean;
  localChange: FilterBoolean;
  sort: FilterSort;
  direction: "asc" | "desc";
}

export const EMPTY_SBOM_FILTERS: SbomFiltersValue = {
  search: "",
  severity: "",
  kev: "all",
  reachability: "",
  license: "",
  source: "",
  linked: "all",
  localChange: "all",
  sort: "name",
  direction: "asc",
};

export const SHIPPED_VIEWS: Readonly<Record<string, SbomFiltersValue>> = {
  Vulnerable: {
    ...EMPTY_SBOM_FILTERS,
    severity: "low",
    sort: "severity",
    direction: "desc",
  },
  Copyleft: { ...EMPTY_SBOM_FILTERS, license: "GPL" },
  "Unlinked to architecture": { ...EMPTY_SBOM_FILTERS, linked: "no" },
};

function editingText(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
}

const controlClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface SbomFiltersProps {
  value: SbomFiltersValue;
  activeView?: string;
  onChange(value: SbomFiltersValue): void;
  onView(view: string): void;
}

export function SbomFilters({
  value,
  activeView,
  onChange,
  onView,
}: SbomFiltersProps): React.JSX.Element {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || editingText(event)) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="border-b border-border bg-card/70 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            name="Search"
          />
          <Input
            aria-label="Search software components"
            className="h-8 pl-8 pr-9 text-xs"
            onChange={(event) => onChange({ ...value, search: event.target.value })}
            placeholder="Search component or group"
            ref={searchRef}
            value={value.search}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            /
          </kbd>
        </div>
        <select
          aria-label="Saved view"
          className={controlClass}
          onChange={(event) => event.target.value && onView(event.target.value)}
          value={activeView ?? ""}
        >
          <option value="">Shipped views</option>
          {Object.keys(SHIPPED_VIEWS).map((view) => (
            <option key={view} value={view}>{view}</option>
          ))}
        </select>
        <select
          aria-label="Minimum severity"
          className={controlClass}
          onChange={(event) => {
            const severity = event.target.value;
            if (
              severity === "" || severity === "critical" || severity === "high" ||
              severity === "medium" || severity === "low"
            ) onChange({ ...value, severity });
          }}
          value={value.severity}
        >
          <option value="">Any severity</option>
          <option value="critical">Critical+</option>
          <option value="high">High+</option>
          <option value="medium">Medium+</option>
          <option value="low">Any vulnerable</option>
        </select>
        <select
          aria-label="Known exploited vulnerability"
          className={controlClass}
          onChange={(event) => {
            const kev = event.target.value;
            if (kev === "all" || kev === "yes" || kev === "no") onChange({ ...value, kev });
          }}
          value={value.kev}
        >
          <option value="all">Any KEV</option>
          <option value="yes">KEV only</option>
          <option value="no">No KEV</option>
        </select>
        <select
          aria-label="Reachability"
          className={controlClass}
          onChange={(event) => {
            const reachability = event.target.value;
            if (
              reachability === "" || reachability === "reachable" ||
              reachability === "unreachable" || reachability === "mixed" ||
              reachability === "unknown"
            ) onChange({ ...value, reachability });
          }}
          value={value.reachability}
        >
          <option value="">Any reachability</option>
          <option value="reachable">Reachable</option>
          <option value="unreachable">Unreachable</option>
          <option value="mixed">Mixed</option>
          <option value="unknown">Unknown</option>
        </select>
        <Input
          aria-label="License filter"
          className="h-8 w-28 text-xs"
          onChange={(event) => onChange({ ...value, license: event.target.value })}
          placeholder="License"
          value={value.license}
        />
        <Input
          aria-label="Component source filter"
          className="h-8 w-28 text-xs"
          onChange={(event) => onChange({ ...value, source: event.target.value })}
          placeholder="Source"
          value={value.source}
        />
        <select
          aria-label="Architecture linkage"
          className={controlClass}
          onChange={(event) => {
            const linked = event.target.value;
            if (linked === "all" || linked === "yes" || linked === "no") onChange({ ...value, linked });
          }}
          value={value.linked}
        >
          <option value="all">Any link</option>
          <option value="yes">Architecture linked</option>
          <option value="no">Architecture unlinked</option>
        </select>
        <select
          aria-label="Local VEX change"
          className={controlClass}
          onChange={(event) => {
            const localChange = event.target.value;
            if (localChange === "all" || localChange === "yes" || localChange === "no") {
              onChange({ ...value, localChange });
            }
          }}
          value={value.localChange}
        >
          <option value="all">Any VEX state</option>
          <option value="yes">Local VEX change</option>
          <option value="no">No local change</option>
        </select>
        <select
          aria-label="Sort components"
          className={controlClass}
          onChange={(event) => {
            const sort = event.target.value;
            if (sort === "name" || sort === "severity" || sort === "kev" || sort === "license") {
              onChange({ ...value, sort });
            }
          }}
          value={value.sort}
        >
          <option value="name">Sort: component</option>
          <option value="severity">Sort: severity</option>
          <option value="kev">Sort: KEV</option>
          <option value="license">Sort: license</option>
        </select>
        <Button
          aria-label={`Sort ${value.direction === "asc" ? "descending" : "ascending"}`}
          className="h-8 px-2"
          onClick={() => onChange({
            ...value,
            direction: value.direction === "asc" ? "desc" : "asc",
          })}
          size="sm"
          variant="outline"
        >
          <Icon aria-hidden="true" className="size-4" name="ArrowUpDown" />
          {value.direction === "asc" ? "Asc" : "Desc"}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Shipped views are immutable. User-saved persistence is unavailable until bb exposes a frontend preference surface.
      </p>
    </div>
  );
}
