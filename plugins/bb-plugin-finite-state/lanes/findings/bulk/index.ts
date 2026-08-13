export { VEX_PLATFORM_BATCH_LIMIT, chunkVexTargets, type VexBulkTarget } from "./chunk.js";
export { type VexApplyResult } from "./results.js";
export {
  createVexBulkPusher,
  pushVexItems,
  registerVexBulkPusher as registerFindingsBulk,
  type PushContext,
  type VexBulkDependencies,
  type VexBulkProgress,
} from "./pusher.js";
