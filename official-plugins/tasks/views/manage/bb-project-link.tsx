import type { BbProjectOption } from "../../shared/contract.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

const NO_LINK = "__none__";

/**
 * UI state for the linked-bb-project picker. Shared by NewProjectDialog and
 * the detail rail.
 */
export interface BbProjectLinkState {
  /** bb project id chosen from the Select. */
  selection: string | null;
}

export function emptyBbProjectLinkState(): BbProjectLinkState {
  return { selection: null };
}

/** Preserve an existing link even when its project is no longer discoverable. */
export function bbProjectLinkStateFor(
  linkedBbProjectId: string | null,
): BbProjectLinkState {
  return { selection: linkedBbProjectId };
}

/** The bb project id the state resolves to; "" means not linked. */
export function resolveBbProjectLink(state: BbProjectLinkState): string {
  return state.selection ?? "";
}

export function BbProjectLinkPicker({
  state,
  onStateChange,
  bbProjects,
  noneLabel = "Not linked",
}: {
  state: BbProjectLinkState;
  onStateChange: (state: BbProjectLinkState) => void;
  bbProjects: readonly BbProjectOption[];
  /** Label for the "no link" Select item (the rail shows "Unlink"). */
  noneLabel?: string;
}) {
  const unavailableSelection =
    state.selection !== null &&
    !bbProjects.some((project) => project.id === state.selection)
      ? state.selection
      : null;
  return (
    <Select
      value={state.selection ?? NO_LINK}
      onValueChange={(value) =>
        onStateChange({ selection: value === NO_LINK ? null : value })
      }
    >
      <SelectTrigger aria-label="Linked bb project" className="h-8">
        <SelectValue>
          {bbProjects.find((project) => project.id === state.selection)?.name ??
            unavailableSelection ??
            noneLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LINK}>{noneLabel}</SelectItem>
        {unavailableSelection !== null ? (
          <SelectItem value={unavailableSelection}>
            Unavailable · {unavailableSelection}
          </SelectItem>
        ) : null}
        {bbProjects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            {project.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
