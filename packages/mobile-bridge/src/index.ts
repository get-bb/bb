export {
  MOBILE_BRIDGE_VERSION,
  NATIVE_BRIDGE_GLOBAL,
  compareBridgeVersions,
  isBridgeUsable,
} from "./version.js";
export {
  NATIVE_CAPABILITIES,
  parseNativeShellHandshake,
  safeAreaInsetsSchema,
  type NativeCapability,
  type NativeShellHandshake,
  type SafeAreaInsets,
} from "./handshake.js";
export {
  type NativeScreen,
  parsePageToShellMessage,
  type BridgeSharePayload,
  type PageToShellMessage,
} from "./messages.js";
export {
  parseShellToPageEvent,
  type BridgeResponse,
  type ShellToPageEvent,
} from "./events.js";
export {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  type NativeShellApi,
} from "./inject.js";
