import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import type { FindingsFilter, FindingLocalState } from "./route.js";

const controlClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function selected(event: React.ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(
    event.currentTarget.selectedOptions,
    (option) => option.value,
  );
}

export function FilterBar({
  value,
  onChange,
  onClear,
}: {
  value: FindingsFilter;
  onChange(value: FindingsFilter): void;
  onClear(): void;
}): React.JSX.Element {
  const [draft, setDraft] = useState({
    sourceComponent: value.component,
    sourceCve: value.cve,
    component: value.component ?? "",
    cve: value.cve ?? "",
  });
  const component =
    draft.sourceComponent === value.component
      ? draft.component
      : (value.component ?? "");
  const cve = draft.sourceCve === value.cve ? draft.cve : (value.cve ?? "");
  useEffect(() => {
    if (component === (value.component ?? "") && cve === (value.cve ?? ""))
      return;
    const timer = window.setTimeout(
      () =>
        onChange({
          ...value,
          component: component || undefined,
          cve: cve || undefined,
        }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [component, cve, onChange, value]);

  return (
    <div
      aria-label="Finding filters"
      className="border-b border-border bg-card/70 px-3 py-2"
      role="search"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            name="Search"
          />
          <Input
            aria-label="Filter component"
            className="h-8 pl-8 text-xs"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sourceComponent: value.component,
                component: event.target.value,
              }))
            }
            placeholder="Component, group, or purl"
            value={component}
          />
        </div>
        <Input
          aria-label="Filter CVE"
          className="h-8 w-36 font-mono text-xs"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              sourceCve: value.cve,
              cve: event.target.value,
            }))
          }
          placeholder="CVE-…"
          value={cve}
        />
        <select
          aria-label="Severity filters"
          className={`${controlClass} min-h-8`}
          multiple
          onChange={(event) =>
            onChange({ ...value, severity: selected(event) })
          }
          size={1}
          value={value.severity ?? []}
        >
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
        <select
          aria-label="Reachability filter"
          className={controlClass}
          onChange={(event) => {
            const next = event.target.value;
            onChange({
              ...value,
              reachability:
                next === "reachable" ||
                next === "unreachable" ||
                next === "unknown"
                  ? next
                  : undefined,
            });
          }}
          value={value.reachability ?? ""}
        >
          <option value="">Any reachability</option>
          <option value="reachable">Reachable</option>
          <option value="unreachable">Unreachable</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          aria-label="KEV filter"
          className={controlClass}
          onChange={(event) => {
            const next = event.target.value;
            onChange({
              ...value,
              kev:
                next === "kev" || next === "vc-kev" || next === "none"
                  ? next
                  : undefined,
            });
          }}
          value={value.kev ?? ""}
        >
          <option value="">Any KEV</option>
          <option value="kev">CISA KEV</option>
          <option value="vc-kev">VulnCheck KEV</option>
          <option value="none">Not KEV</option>
        </select>
        <select
          aria-label="EPSS band"
          className={controlClass}
          onChange={(event) =>
            onChange({
              ...value,
              epssGte: event.target.value
                ? Number(event.target.value)
                : undefined,
            })
          }
          value={value.epssGte === undefined ? "" : String(value.epssGte)}
        >
          <option value="">Any EPSS</option>
          <option value="0.01">≥ 1%</option>
          <option value="0.1">≥ 10%</option>
          <option value="0.5">≥ 50%</option>
          <option value="0.9">≥ 90%</option>
        </select>
        <Input
          aria-label="Minimum EPSS threshold"
          className="h-8 w-24 text-xs tabular-nums"
          max="1"
          min="0"
          onChange={(event) =>
            onChange({
              ...value,
              epssGte:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            })
          }
          placeholder="EPSS ≥"
          step="0.01"
          type="number"
          value={value.epssGte ?? ""}
        />
        <select
          aria-label="Triage state filters"
          className={`${controlClass} min-h-8`}
          multiple
          onChange={(event) => onChange({ ...value, triage: selected(event) })}
          size={1}
          value={value.triage ?? []}
        >
          <option value="unknown">Untriaged</option>
          <option value="affected">Affected</option>
          <option value="not_affected">Not affected</option>
          <option value="fixed">Fixed</option>
          <option value="under_investigation">Investigating</option>
        </select>
        <select
          aria-label="Finding type filters"
          className={`${controlClass} min-h-8`}
          multiple
          onChange={(event) =>
            onChange({ ...value, findingType: selected(event) })
          }
          size={1}
          value={value.findingType ?? []}
        >
          <option value="vulnerability">Vulnerability</option>
          <option value="misconfiguration">Misconfiguration</option>
          <option value="secret">Secret</option>
          <option value="malware">Malware</option>
        </select>
        <select
          aria-label="Local change state filters"
          className={`${controlClass} min-h-8`}
          multiple
          onChange={(event) =>
            onChange({
              ...value,
              localState: selected(event) as FindingLocalState[],
            })
          }
          size={1}
          value={value.localState ?? []}
        >
          <option value="none">No local change</option>
          <option value="local">Local</option>
          <option value="conflicted">Conflicted</option>
          <option value="stale">Stale</option>
          <option value="needs_completion">Needs completion</option>
        </select>
        <Button
          aria-label="Clear all finding filters"
          onClick={onClear}
          size="sm"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-4" name="X" />
          Clear
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Sorted by highest risk, then finding ID.
      </p>
    </div>
  );
}
