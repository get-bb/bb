// Runtime polyfills that Expo's winter runtime does not provide.
//
// Expo SDK 57 already installs URL/URLSearchParams, TextEncoder/TextDecoder,
// structuredClone, AbortSignal helpers, FormData patches, and replaces the
// global fetch with `expo/fetch`. The one gap the shared bb code relies on is
// `crypto.getRandomValues` (used by nanoid). expo-crypto exposes a native
// implementation but does not install it on `globalThis` by itself.
import { getRandomValues } from "expo-crypto";

type CryptoLike = { getRandomValues?: unknown };

const globalCrypto = (globalThis as { crypto?: CryptoLike }).crypto;
if (!globalCrypto) {
  (globalThis as { crypto?: CryptoLike }).crypto = { getRandomValues };
} else if (typeof globalCrypto.getRandomValues !== "function") {
  globalCrypto.getRandomValues = getRandomValues;
}
