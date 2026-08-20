// App shell glue: providers, boot, and hooks screens read from. RN-dependent.
export {
  getActiveProfileConnector,
  waitForActiveConnection,
} from "./connector";
export { e2eModeEnabled, resetLocalState, resetOnLaunch } from "./e2e";
export {
  PaletteProvider,
  ServerPaletteSync,
  paletteFromThemeId,
} from "./PaletteProvider";
export {
  ProfilesProvider,
  useProfileClient,
  useProfiles,
  type ProfilesContextValue,
} from "./ProfilesProvider";
export {
  systemVersionQueryKey,
  useSystemConfigQuery,
  useSystemVersionQuery,
} from "./queries";
export {
  ThreadOpenSignalHandler,
  pathnameIsThread,
} from "./ThreadOpenSignalHandler";
export { ShareIntentHandler } from "./ShareIntentHandler";
export { useAppBoot, type AppBootState } from "./useAppBoot";
export { useOpenThreadInProfile } from "./useOpenThread";
export {
  useConnectionBanner,
  useRealtimeConnectionState,
} from "./useRealtimeState";
