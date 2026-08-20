export {
  createHapticsPreferenceStore,
  HAPTICS_ENABLED_DEFAULT,
  HAPTICS_ENABLED_STORAGE_KEY,
  hapticKindForButton,
  parseHapticsEnabled,
  resolveHapticCall,
  serializeHapticsEnabled,
  type ButtonHaptic,
  type HapticCall,
  type HapticKind,
  type HapticsPreferenceStorage,
  type HapticsPreferenceStore,
} from "./haptics-policy";
export {
  getHapticsPreferenceStore,
  haptic,
  useHapticsEnabled,
} from "./haptics";
