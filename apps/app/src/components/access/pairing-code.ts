import { asHttpError, getHttpErrorMessage } from "@/lib/http-error";
import { DesktopPairingError } from "./redeem-pairing";

const PAIRING_CODE_LENGTH = 10;

export function formatPairingCodeInput(raw: string): string {
  const compact = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/gu, "")
    .slice(0, PAIRING_CODE_LENGTH);
  return compact.length > 5
    ? `${compact.slice(0, 5)}-${compact.slice(5)}`
    : compact;
}

export function isCompletePairingCode(code: string): boolean {
  return code.replace(/-/gu, "").length === PAIRING_CODE_LENGTH;
}

export function pairingCodeFromHash(hash: string): string | null {
  const code = new URLSearchParams(hash.replace(/^#/u, "")).get("code");
  return code === null ? null : formatPairingCodeInput(code);
}

export function pairingLink(origin: string, code: string): string {
  return `${origin}/pair#code=${encodeURIComponent(code)}`;
}

function pairingCodeMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "invalid_pairing_code":
      return "That code is wrong, expired or already used. Make a new code and try again.";
    case "pairing_rate_limited":
      return "Too many wrong codes. Wait a few minutes, then try again.";
    case "credential_requires_https":
      return "This sign-in was made over HTTPS. Open the HTTPS address, or sign in again here.";
    default:
      return null;
  }
}

export function pairingErrorMessage(error: unknown): string {
  if (error instanceof DesktopPairingError) {
    return pairingCodeMessage(error.code) ?? error.message;
  }
  const httpError = asHttpError(error);
  if (httpError === null) return "Could not reach this bb. Try again.";
  return (
    pairingCodeMessage(httpError.code) ??
    getHttpErrorMessage(httpError) ??
    "Sign-in failed. Try again."
  );
}
