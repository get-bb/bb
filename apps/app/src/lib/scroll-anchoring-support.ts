/**
 * Whether the browser implements CSS scroll anchoring (`overflow-anchor`).
 * Chromium and Firefox do; WebKit (every iOS browser) does not. Callers that
 * lean on scroll anchoring to hide layout motion, or that toggle
 * `overflow-anchor` to steer it, skip that work where it can have no effect.
 */
export function supportsScrollAnchoring(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("overflow-anchor", "none")
  );
}
