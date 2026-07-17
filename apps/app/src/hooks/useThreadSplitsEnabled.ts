/**
 * Thread splits are a released feature. Keeping this hook centralizes split
 * availability at existing layout call sites.
 */
export function useThreadSplitsEnabled(): boolean {
  return true;
}
