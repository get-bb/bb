import { normalizeDeviceCode } from "@bb/sealed-channel";
import { randomInt } from "node:crypto";

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface DeviceCode {
  code: string;
  expiresAt: number;
}

export interface DeviceCodeIssuer {
  issue(): DeviceCode;
  consumeMatching(matches: (code: string) => boolean): string | null;
}

function randomCode(): string {
  let out = "";
  for (let index = 0; index < 12; index += 1) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (index === 3 || index === 7) out += "-";
  }
  return out;
}

export { normalizeDeviceCode };

export function createDeviceCodeIssuer(
  now: () => number = Date.now,
): DeviceCodeIssuer {
  const codes = new Map<string, DeviceCode>();
  const sweep = () => {
    const at = now();
    for (const [code, entry] of codes) {
      if (entry.expiresAt <= at) codes.delete(code);
    }
  };
  return {
    issue() {
      sweep();
      let code = randomCode();
      while (codes.has(code)) code = randomCode();
      const entry = { code, expiresAt: now() + DEVICE_CODE_TTL_MS };
      codes.set(code, entry);
      return entry;
    },
    consumeMatching(matches) {
      sweep();
      for (const code of codes.keys()) {
        if (matches(code)) {
          codes.delete(code);
          return code;
        }
      }
      return null;
    },
  };
}
