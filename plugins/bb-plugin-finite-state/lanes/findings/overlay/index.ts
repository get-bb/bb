import { registeredAdapters } from "../../sync/engine/adapter.js";
import type { PluginContext } from "../../../lib/context.js";
import { rebuildOverlayIndex } from "./indexer.js";
import { watchOverlay } from "./watcher.js";
import { removeDecision, setDecision, setVendorProposal } from "./writer.js";

export * from "./indexer.js";
export * from "./reader.js";
export * from "./schema.js";
export * from "./watcher.js";
export * from "./writer.js";

/**
 * Confirms that L2 installed the frozen VEX adapter/serializer consumed by the
 * overlay writer and reader. File observation is started per verified
 * worktree through `watchOverlay`, because plugin startup has no worktree.
 */
export function registerFindingsOverlay(ctx: PluginContext): void {
  const adapter = registeredAdapters().find((candidate) => candidate.kind === "vexDecision");
  if (adapter === undefined || adapter.serializer.entityKind !== "vexDecision") {
    throw new Error("Findings overlay requires the registered vexDecision sync adapter");
  }
  const db = ctx.db();
  ctx.service("findings.overlay", () => ({
    setDecision,
    setVendorProposal,
    removeDecision,
    rebuild: (root: string) => rebuildOverlayIndex(db, root),
    watch: (root: string) => watchOverlay({
      db,
      root,
      publish: (channel, payload) => ctx.bb.realtime.publish(channel, payload),
      onError: (error) => ctx.log.error(`Findings overlay watcher failed: ${error instanceof Error ? error.message : String(error)}`),
    }),
  }));
}
