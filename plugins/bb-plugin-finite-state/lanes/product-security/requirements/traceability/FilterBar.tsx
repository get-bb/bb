import { Icon } from "@bb/shared-ui/icon";
import type { RequirementFacets } from "./query.js";
import type { RequirementFilters } from "./filters.js";
import {
  earsPatternSchema,
  requirementEvidenceStateSchema,
  requirementTypeSchema,
  verificationTierSchema,
} from "../cards/schema.js";

const EMPTY_FACETS: RequirementFacets = {
  pattern: [], reqType: [], priority: [], evidenceState: [], tier: [], stale: 0, localOnly: 0,
};

function toggle<T extends string>(values: readonly T[] | undefined, value: T): T[] | undefined {
  const next = new Set(values ?? []);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size > 0 ? [...next] : undefined;
}

function facetCount(facets: readonly { value: string; count: number }[], value: string): number {
  return facets.find((facet) => facet.value === value)?.count ?? 0;
}

function MultiFilter<T extends string>({
  label,
  values,
  selected,
  counts,
  onChange,
}: {
  label: string;
  values: readonly T[];
  selected?: readonly T[];
  counts: readonly { value: string; count: number }[];
  onChange(values: T[] | undefined): void;
}): React.JSX.Element {
  return (
    <details className="relative">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {label}{selected?.length ? ` · ${selected.length}` : ""}
        <Icon aria-hidden="true" className="size-3" name="ChevronDown" />
      </summary>
      <div className="absolute left-0 z-30 mt-1 max-h-64 min-w-52 overflow-auto rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md">
        {values.map((value) => (
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted" key={value}>
            <input
              checked={selected?.includes(value) ?? false}
              className="size-3.5 accent-primary"
              onChange={() => onChange(toggle(selected, value))}
              type="checkbox"
            />
            <span className="flex-1">{value.replaceAll("_", " ")}</span>
            <span className="tabular-nums text-muted-foreground">{facetCount(counts, value)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export function FilterBar({
  filters,
  facets = EMPTY_FACETS,
  total,
  onChange,
}: {
  filters: RequirementFilters;
  facets?: RequirementFacets;
  total: number | null;
  onChange(filters: RequirementFilters): void;
}): React.JSX.Element {
  const evidence = filters.evidenceState ?? [];
  return (
    <section aria-label="Requirement trace filters" className="shrink-0 border-b border-border bg-card/70 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Icon aria-hidden="true" className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" name="Search" />
          <label className="sr-only" htmlFor="trace-requirement-search">Search requirements</label>
          <input
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            id="trace-requirement-search"
            onChange={(event) => onChange({ ...filters, text: event.target.value || undefined, cursor: undefined })}
            placeholder="Search ID, EARS text, or source description"
            value={filters.text ?? ""}
          />
        </div>
        <span className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-muted-foreground">
          {total === null ? "—" : total.toLocaleString()} matches
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MultiFilter label="EARS" values={earsPatternSchema.options} selected={filters.pattern} counts={facets.pattern} onChange={(pattern) => onChange({ ...filters, pattern, cursor: undefined })} />
        <MultiFilter label="Type" values={requirementTypeSchema.options} selected={filters.reqType} counts={facets.reqType} onChange={(reqType) => onChange({ ...filters, reqType, cursor: undefined })} />
        <MultiFilter label="Priority" values={facets.priority.map((item) => item.value)} selected={filters.priority} counts={facets.priority} onChange={(priority) => onChange({ ...filters, priority, cursor: undefined })} />
        <MultiFilter label="Evidence" values={requirementEvidenceStateSchema.options} selected={filters.evidenceState} counts={facets.evidenceState} onChange={(evidenceState) => onChange({ ...filters, evidenceState, cursor: undefined })} />
        <label className="sr-only" htmlFor="trace-tier-filter">Tier presence</label>
        <select
          className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          id="trace-tier-filter"
          onChange={(event) => onChange({ ...filters, tier: event.target.value ? verificationTierSchema.parse(event.target.value) : undefined, cursor: undefined })}
          value={filters.tier ?? ""}
        >
          <option value="">Any tier</option>
          {verificationTierSchema.options.map((tier) => <option key={tier} value={tier}>{tier} ({facetCount(facets.tier, tier)})</option>)}
        </select>
        <input
          aria-label="Standard or clause"
          className="h-8 w-44 rounded-md border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(event) => onChange({ ...filters, standardClause: event.target.value || undefined, cursor: undefined })}
          placeholder="Standard / clause"
          value={filters.standardClause ?? ""}
        />
        <input
          aria-label="Threat slug"
          className="h-8 w-40 rounded-md border border-input bg-background px-2.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onChange={(event) => onChange({ ...filters, threat: event.target.value || undefined, cursor: undefined })}
          placeholder="THREAT-*"
          value={filters.threat ?? ""}
        />
        {[
          { label: `Stale (${facets.stale})`, active: filters.stale === true, change: () => onChange({ ...filters, stale: filters.stale ? undefined : true, cursor: undefined }) },
          { label: "Failing", active: evidence.includes("failed"), change: () => onChange({ ...filters, evidenceState: toggle(evidence, "failed"), cursor: undefined }) },
          { label: `Local (${facets.localOnly})`, active: filters.localOnly === true, change: () => onChange({ ...filters, localOnly: filters.localOnly ? undefined : true, cursor: undefined }) },
        ].map((item) => (
          <button
            aria-pressed={item.active}
            className={item.active
              ? "h-8 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
              : "h-8 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted"}
            key={item.label}
            onClick={item.change}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
