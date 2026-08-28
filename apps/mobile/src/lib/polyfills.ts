import { getRandomValues } from "expo-crypto";

const globalCrypto = globalThis.crypto;
if (!globalCrypto) {
  Object.defineProperty(globalThis, "crypto", { value: { getRandomValues } });
} else if (!(globalCrypto.getRandomValues instanceof Function)) {
  Object.defineProperty(globalCrypto, "getRandomValues", {
    value: getRandomValues,
  });
}
