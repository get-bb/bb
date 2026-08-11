/** Shared visual treatment for thread drag previews across sidebar and panes. */
export const THREAD_DRAG_GHOST_STYLE = {
  maxWidth: "260px",
  padding: "6px 12px",
  borderRadius: "10px",
  fontSize: "12.5px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  boxShadow: "0 6px 20px color-mix(in oklab, var(--ink) 22%, transparent)",
} as const;
