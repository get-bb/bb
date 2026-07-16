import type { BbProjectOption } from "../../shared/contract.js";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_LINK = "__none__";
const CUSTOM_LINK = "__custom__";

/**
 * UI state for the linked-bb-project picker: a Select of workspace projects
 * with a raw-id fallback ("Custom id…", or the only mode when the workspace
 * list is unavailable/empty). Shared by NewProjectDialog and the detail rail.
 */
export interface BbProjectLinkState {
  /** bb project id chosen from the Select (ignored in custom mode). */
  selection: string | null;
  customMode: boolean;
  /** Free-text id, kept even while the Select is active so a mode round-trip
   *  doesn't lose the draft. */
  customText: string;
}

export function emptyBbProjectLinkState(): BbProjectLinkState {
  return { selection: null, customMode: false, customText: "" };
}

/** Initial state for an existing link: select it when the workspace list
 *  contains it, otherwise show it in the custom-id input. */
export function bbProjectLinkStateFor(
  linkedBbProjectId: string | null,
  bbProjects: readonly BbProjectOption[],
): BbProjectLinkState {
  if (linkedBbProjectId === null) return emptyBbProjectLinkState();
  return bbProjects.some((project) => project.id === linkedBbProjectId)
    ? { selection: linkedBbProjectId, customMode: false, customText: "" }
    : { selection: null, customMode: true, customText: linkedBbProjectId };
}

function usingCustom(
  state: BbProjectLinkState,
  bbProjects: readonly BbProjectOption[],
): boolean {
  return bbProjects.length === 0 || state.customMode;
}

/** The bb project id the state resolves to; "" means not linked. */
export function resolveBbProjectLink(
  state: BbProjectLinkState,
  bbProjects: readonly BbProjectOption[],
): string {
  return usingCustom(state, bbProjects)
    ? state.customText.trim()
    : (state.selection ?? "");
}

export function bbProjectLinkError(
  state: BbProjectLinkState,
  bbProjects: readonly BbProjectOption[],
): string | null {
  const trimmed = state.customText.trim();
  return usingCustom(state, bbProjects) &&
    trimmed !== "" &&
    !trimmed.startsWith("proj_")
    ? "bb project ids start with proj_."
    : null;
}

export function BbProjectLinkPicker({
  state,
  onStateChange,
  bbProjects,
  noneLabel = "Not linked",
  onCustomSubmit,
}: {
  state: BbProjectLinkState;
  onStateChange: (state: BbProjectLinkState) => void;
  bbProjects: readonly BbProjectOption[];
  /** Label for the "no link" Select item (the rail shows "Unlink"). */
  noneLabel?: string;
  /** Enter in the custom-id input (the rail saves; the dialog has no use). */
  onCustomSubmit?: () => void;
}) {
  const showPicker = bbProjects.length > 0;
  const error = bbProjectLinkError(state, bbProjects);
  return (
    <>
      {showPicker ? (
        <Select
          value={state.customMode ? CUSTOM_LINK : (state.selection ?? NO_LINK)}
          onValueChange={(value) => {
            if (value === CUSTOM_LINK) {
              onStateChange({ ...state, customMode: true });
              return;
            }
            onStateChange({
              ...state,
              customMode: false,
              selection: value === NO_LINK ? null : value,
            });
          }}
        >
          <SelectTrigger aria-label="Linked bb project" className="h-8">
            <SelectValue>
              {state.customMode
                ? "Custom id…"
                : (bbProjects.find(
                    (project) => project.id === state.selection,
                  )?.name ?? noneLabel)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_LINK}>{noneLabel}</SelectItem>
            {bbProjects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={CUSTOM_LINK}>Custom id…</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      {usingCustom(state, bbProjects) ? (
        <Input
          value={state.customText}
          placeholder="proj_…"
          aria-invalid={error !== null}
          onChange={(event) =>
            onStateChange({ ...state, customText: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && onCustomSubmit !== undefined) {
              event.preventDefault();
              onCustomSubmit();
            }
          }}
          className={
            showPicker ? "mt-1.5 h-8 font-mono text-xs" : "h-8 font-mono text-xs"
          }
        />
      ) : null}
    </>
  );
}
