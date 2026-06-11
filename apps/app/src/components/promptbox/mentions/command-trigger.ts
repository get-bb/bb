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
export function commandTriggerForProvider(providerId: string): "/" | "$" | null {
  switch (providerId) {
    case "claude-code":
      return "/";
    case "codex":
      return "$";
    default:
      return null;
  }
}
