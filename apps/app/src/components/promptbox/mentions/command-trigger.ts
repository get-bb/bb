/**
 * The trigger character a provider uses to invoke skills/commands in the
 * composer, or `null` when the provider has no command surface.
 *
 * - `claude-code` → `/` (skills + legacy `.claude/commands`)
 * - `codex` → `$` (Codex skills; `/<skill>` is unrecognized by Codex)
 * - anything else (e.g. `pi`) → `null` (the command typeahead is inert)
 *
 * Takes a plain `string` because callers receive the provider id from thread
 * data / new-thread options where it is not yet narrowed to a known provider.
 */
export function commandTriggerForProvider(
  providerId: string,
): "/" | "$" | null {
  switch (providerId) {
    case "claude-code":
      return "/";
    case "codex":
      return "$";
    default:
      return null;
  }
}

/**
 * A selected command is a one-position mention atom in the editor doc. The
 * dismissed range is based on that rendered node width plus any space inserted
 * after it, not on the serialized provider token length (`/review`, `$test`,
 * etc.).
 */
export function commandPillDismissedRangeEnd({
  triggerPosition,
  trailingText,
}: {
  triggerPosition: number;
  trailingText: string;
}): number {
  return triggerPosition + 1 + trailingText.length;
}
