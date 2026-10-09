import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const browserBuild: typeof import("react-resizable-panels") = require(
  join(
    dirname(require.resolve("react-resizable-panels/package.json")),
    "dist/react-resizable-panels.browser.development.cjs.js",
  ),
);

export const {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  disableGlobalCursorStyles,
} = browserBuild;
