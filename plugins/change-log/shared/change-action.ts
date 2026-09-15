import type { ChangeAction } from "./contract.js";

interface FileChangeLike {
  kind: string | null;
  movePath: string | null;
  diff: string | null;
}

function normalizeKind(kind: string | null): string {
  return (kind ?? "").toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function hasSubstantiveDiff(diff: string | null): boolean {
  if (diff === null || diff === "") return false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+") || line.startsWith("-")) return true;
  }
  return false;
}

export function getFileChangeAction(change: FileChangeLike): ChangeAction {
  if (change.movePath !== null && change.movePath !== "") {
    return hasSubstantiveDiff(change.diff) ? "edited" : "renamed";
  }
  const kind = normalizeKind(change.kind);
  if (kind.includes("add") || kind.includes("create")) return "created";
  if (kind.includes("delete") || kind.includes("remove")) return "deleted";
  return "edited";
}

export const CHANGE_ACTION_LABEL: Record<ChangeAction, string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
  renamed: "Renamed",
};

export const CHANGE_ACTION_ICON: Record<ChangeAction, string> = {
  created: "Plus",
  edited: "Edit",
  deleted: "Trash2",
  renamed: "ArrowRight",
};
