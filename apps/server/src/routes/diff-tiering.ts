import type { RawDiffFileStat } from "@bb/domain";
import { type DiffFileEntry, letterToChangeKind } from "@bb/server-contract";
import {
  DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES,
  DIFF_FILE_TOO_LARGE_CHANGED_LINES,
} from "../constants.js";

/**
 * Map a daemon `RawDiffFileStat` to the contract's `DiffFileEntry`, stamping the
 * server-owned tiering decision. Pure — no IO, no host calls.
 *
 * `loadMode` policy (changed = additions + deletions):
 * - `too_large` when changed exceeds `DIFF_FILE_TOO_LARGE_CHANGED_LINES` (no
 *   patch is offered for these),
 * - else `on_demand` when the file is binary or changed exceeds
 *   `DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES`,
 * - else `auto` (patch loads eagerly).
 */
export function rawDiffFileStatToEntry(stat: RawDiffFileStat): DiffFileEntry {
  const changedLines = stat.additions + stat.deletions;
  const loadMode = resolveLoadMode({ changedLines, binary: stat.binary });
  return {
    path: stat.path,
    previousPath: stat.previousPath,
    changeKind: letterToChangeKind({ letter: stat.statusLetter }),
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    origin: stat.origin,
    loadMode,
  };
}

function resolveLoadMode({
  changedLines,
  binary,
}: {
  changedLines: number;
  binary: boolean;
}): DiffFileEntry["loadMode"] {
  if (changedLines > DIFF_FILE_TOO_LARGE_CHANGED_LINES) {
    return "too_large";
  }
  if (binary || changedLines > DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES) {
    return "on_demand";
  }
  return "auto";
}
