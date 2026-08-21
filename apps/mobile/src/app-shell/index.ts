// App shell glue: providers, boot, and hooks screens read from. RN-dependent.
export { e2eModeEnabled, resetLocalState } from "./e2e";
export { PaletteProvider, ServerPaletteSync } from "./PaletteProvider";
export {
  ProfilesProvider,
  useProfileClient,
  useProfiles,
  type ProfilesContextValue,
} from "./ProfilesProvider";
export { ThreadOpenSignalHandler } from "./ThreadOpenSignalHandler";
export { ShareIntentHandler } from "./ShareIntentHandler";
export { useAppBoot, type AppBootState } from "./useAppBoot";
export {
  useConnectionBanner,
  useRealtimeConnectionState,
} from "./useRealtimeState";
