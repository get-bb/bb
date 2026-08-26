/**
 * The contract between the bb mobile shell and the page it renders.
 *
 * The shell ships in the App Store and the page ships with the server, so the
 * two versions never match by construction. Three rules hold everywhere in
 * this package:
 *
 * 1. Both sides parse at the boundary and pass typed values inward.
 * 2. Neither side throws on an unknown message. It is dropped.
 * 3. Every bridge call has a web fallback, because a missing bridge is normal.
 */
export {
  MOBILE_BRIDGE_VERSION,
  MINIMUM_MOBILE_BRIDGE_VERSION,
  NATIVE_BRIDGE_GLOBAL,
  compareBridgeVersions,
  isBridgeUsable,
  type BridgeCompatibility,
} from "./version.js";
export {
  NATIVE_CAPABILITIES,
  currentBridgeVersion,
  nativeShellHandshakeSchema,
  parseNativeShellHandshake,
  safeAreaInsetsSchema,
  type NativeCapability,
  type NativeShellHandshake,
  type SafeAreaInsets,
} from "./handshake.js";
export {
  HAPTIC_KINDS,
  NATIVE_SCREENS,
  nativeScreenSchema,
  type NativeScreen,
  pageToShellMessageSchema,
  parsePageToShellMessage,
  type BridgeHapticKind,
  type BridgeRequest,
  type BridgeRequestKind,
  type BridgeSharePayload,
  type PageToShellMessage,
  type PageToShellMessageType,
  type ParsedPageMessage,
} from "./messages.js";
export {
  parseShellToPageEvent,
  shareResultSchema,
  shellToPageEventSchema,
  type BridgeResponse,
  type ShareResult,
  type ShellToPageEvent,
} from "./events.js";
export {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  type NativeShellApi,
} from "./inject.js";
