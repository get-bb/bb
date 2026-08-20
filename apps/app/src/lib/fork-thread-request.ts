// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  isThreadForkable,
  buildForkThreadRequest,
} from "@bb/client-core";
export type {
  ForkThreadCreateSeed,
  BuildForkThreadRequestArgs,
} from "@bb/client-core";
