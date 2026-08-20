// Moved to @bb/client-core (shared with the native app); re-exported here so web imports keep resolving.
export {
  THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY,
  buildThreadHandoffLocationState,
  readThreadHandoffCreateSeedFromLocationState,
  buildThreadHandoffPromptDraft,
} from "@bb/client-core";
export type {
  ThreadHandoffCreateSeed,
  ThreadHandoffLocationState,
} from "@bb/client-core";
