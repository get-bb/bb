// Browser-safe public command surface. Server registration imports the same
// implementation from writer.ts so its dependency graph never crosses TSX.
export {
  applyCanvasCommand,
  CanvasCasConflictError,
  CanvasSlugReuseError,
  type CanvasEditCommand,
  type EditDeps,
  type EditResult,
} from "./writer.js";
export type { DeletionImpact } from "./schema.js";
