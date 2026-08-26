/**
 * Why voice input is unavailable, and how to say so.
 *
 * `getUserMedia` only exists in a secure context, so a bb server reached over
 * plain HTTP on a LAN has no microphone at all — in a browser and inside the
 * mobile shell alike (plan section 11.6). "Not supported in this browser" is
 * wrong there and leaves the user with nothing to act on.
 */

export type VoiceUnsupportedReason = "insecure-origin" | "unsupported-browser";

export interface VoiceSupportEnvironment {
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
  isSecureContext: boolean;
}

export interface VoiceSupport {
  isSupported: boolean;
  reason: VoiceUnsupportedReason | null;
}

export function resolveVoiceSupport(
  environment: VoiceSupportEnvironment,
): VoiceSupport {
  if (environment.hasMediaDevices && environment.hasMediaRecorder) {
    return { isSupported: true, reason: null };
  }
  // A non-secure origin removes `navigator.mediaDevices` entirely, which is
  // the same symptom as an old browser but a different fix.
  return {
    isSupported: false,
    reason: environment.isSecureContext
      ? "unsupported-browser"
      : "insecure-origin",
  };
}

export function voiceUnsupportedMessage(
  reason: VoiceUnsupportedReason | null,
): string {
  return reason === "insecure-origin"
    ? "Voice input needs an HTTPS connection to this server"
    : "Voice input is not supported in this browser";
}

/** Read the current window. Returns the "no browser" answer during SSR. */
export function readVoiceSupportEnvironment(): VoiceSupportEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      hasMediaDevices: false,
      hasMediaRecorder: false,
      isSecureContext: true,
    };
  }
  return {
    hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
    hasMediaRecorder: typeof window.MediaRecorder !== "undefined",
    isSecureContext: window.isSecureContext !== false,
  };
}
