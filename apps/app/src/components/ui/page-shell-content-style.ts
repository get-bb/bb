import type { CSSProperties } from "react";

export const PAGE_SHELL_CONTENT_STYLE =
  /* SAFETY: React omits custom properties from CSSProperties, but this object contains a valid CSS custom property. */ {
    "--md-content-w": "760px",
  } as CSSProperties;
