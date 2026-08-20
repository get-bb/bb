// Pure profile layer. Native adapters live in ../native (expo-secure-store).
export {
  PROFILE_LABEL_MAX_LENGTH,
  connectServerProfileSchema,
  directServerProfileSchema,
  isConnectProfile,
  serverProfileSchema,
  type ConnectServerProfile,
  type DirectServerProfile,
  type NewServerProfile,
  type ServerProfile,
  type ServerProfileMode,
  type ServerProfilePatch,
} from "./profile";
export {
  isLoopbackHost,
  normalizeServerUrl,
  validateDirectServerUrl,
  type DirectUrlErrorCode,
  type DirectUrlValidation,
  type DirectUrlWarning,
} from "./direct-url";
export {
  probeServer,
  type ProbeFetch,
  type ProbeServerOptions,
  type ProbeServerResult,
  type ProbeStage,
} from "./probe";
export {
  PROFILE_INDEX_STORAGE_KEY,
  PROFILE_STORAGE_KEY_PREFIX,
  createProfileStore,
  profileStorageKey,
  type CreateProfileStoreDeps,
  type ProfileStore,
  type ProfileStoreState,
  type ProfileStoreStatus,
} from "./profile-store";
export {
  SECURE_STORAGE_MAX_VALUE_BYTES,
  createMemorySecureStorage,
  type SecureStorageLike,
} from "./secure-storage";
export { useProfileStoreState } from "./use-profile-store";
