/**
 * `?initialPrompt=` on the root compose route.
 *
 * The mobile shell's share extension hands a shared link or selection to the
 * page this way, because a share arrives from outside the app and cannot use
 * the router state the in-app seeds use. Anything else that can build a URL —
 * a bookmark, a shortcut, a plugin — gets the same entry point.
 */

/**
 * Longer than any share sheet produces, short enough that a hostile URL
 * cannot wedge the editor. The composer accepts more once the user types.
 */
export const INITIAL_PROMPT_MAX_LENGTH = 8000;

export const INITIAL_PROMPT_SEARCH_PARAM = "initialPrompt";

/**
 * The prompt a URL carries, or null. Never throws on a malformed query, and
 * refuses an empty or whitespace-only value so a stray `?initialPrompt=` does
 * not start a compose session the user did not ask for.
 */
export function readInitialPromptFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const raw = params.get(INITIAL_PROMPT_SEARCH_PARAM);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, INITIAL_PROMPT_MAX_LENGTH);
}

/**
 * The same search string with the parameter removed, so a reload or a back
 * navigation does not seed the composer a second time.
 */
export function stripInitialPromptFromSearch(search: string): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return search;
  }
  params.delete(INITIAL_PROMPT_SEARCH_PARAM);
  const rest = params.toString();
  return rest.length > 0 ? `?${rest}` : "";
}
