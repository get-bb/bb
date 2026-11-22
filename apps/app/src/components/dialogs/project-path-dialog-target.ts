import type { ProjectPathDialogTarget } from "./ProjectPathDialog";

export function projectPathDialogTargetHostId(
  target: ProjectPathDialogTarget,
): string | null {
  return target.kind === "update" || target.kind === "add-folder"
    ? target.hostId
    : null;
}
