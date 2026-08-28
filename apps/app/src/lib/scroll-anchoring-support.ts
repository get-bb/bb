export function supportsScrollAnchoring(): boolean {
  const css = globalThis.CSS;
  return css !== undefined && css.supports("overflow-anchor", "none");
}
