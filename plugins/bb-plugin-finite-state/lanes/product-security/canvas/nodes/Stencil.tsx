import { useMemo, useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { ASSURANCE_STUDIO_COMPONENT_TYPES } from "../editing/schema.js";
import { ComponentTypeIcon } from "./ComponentNode.js";
import { wp35MutationStubs } from "./selection.js";

export function Stencil(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const visibleTypes = useMemo(
    () =>
      ASSURANCE_STUDIO_COMPONENT_TYPES.filter((type) =>
        type.includes(query.trim().toLowerCase()),
      ),
    [query],
  );
  return (
    <aside
      aria-label="Architecture stencil"
      className="h-full min-h-0 w-60 shrink-0 overflow-y-auto border-r border-border bg-card p-3 text-card-foreground"
    >
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-1 py-2 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Architecture stencil
        <Icon aria-hidden="true" name={open ? "ChevronUp" : "ChevronDown"} />
      </button>
      {open ? (
        <>
          <label className="sr-only" htmlFor="architecture-stencil-filter">
            Filter node types
          </label>
          <Input
            id="architecture-stencil-filter"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter node types"
            value={query}
          />
          <ul className="mt-3 space-y-1" aria-label="Available component types">
            {visibleTypes.map((type) => (
              <li
                className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm"
                key={type}
              >
                <ComponentTypeIcon className="size-4" componentType={type} />
                <span className="min-w-0 flex-1 truncate">
                  {type.replaceAll("_", " ")}
                </span>
                <Button
                  aria-label={`Add ${type} (available in WP-35)`}
                  disabled
                  onClick={wp35MutationStubs.create}
                  size="icon"
                  variant="ghost"
                >
                  <Icon aria-hidden="true" name="SectionAdd" />
                </Button>
              </li>
            ))}
            <li className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-2 text-sm">
              <Icon aria-hidden="true" className="size-4" name="Layers" />
              <span className="flex-1">zone container</span>
              <Button
                aria-label="Add zone (available in WP-35)"
                disabled
                onClick={wp35MutationStubs.create}
                size="icon"
                variant="ghost"
              >
                <Icon aria-hidden="true" name="SectionAdd" />
              </Button>
            </li>
          </ul>
          <Badge className="mt-3" variant="outline">
            Read-only · editing lands in WP-35
          </Badge>
        </>
      ) : null}
    </aside>
  );
}
