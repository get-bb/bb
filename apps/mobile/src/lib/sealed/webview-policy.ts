import type { MobileSealedState } from "./sealed-transport";

export type WebViewSealedVerdict = "allow" | "wait" | "blocked";

export function webViewSealedVerdict(
  state: MobileSealedState | null,
): WebViewSealedVerdict {
  if (state === null) return "allow";
  switch (state.kind) {
    case "idle":
    case "probing":
      return "wait";
    case "plaintext":
      return state.accepted ? "allow" : "blocked";
    case "offline":
      return state.fingerprint === null ? "blocked" : "allow";
    case "ready":
      return state.verified || state.acknowledged ? "allow" : "blocked";
    case "connecting":
    case "pending":
    case "rejected":
    case "key-mismatch":
      return "allow";
  }
}

export function pageMustSeal(state: MobileSealedState | null): boolean {
  return state !== null && state.kind !== "plaintext";
}
