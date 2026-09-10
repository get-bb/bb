/**
 * Overall voice-transcription audio cap (10MB raw). This is the largest audio
 * the plugin transport can actually carry: host RPC caps JSON payloads at
 * 16MB, base64 inflates raw audio by 4/3 (16MB -> 12MB), and the JSON envelope
 * around the payload takes the rest. Values above this cannot succeed on any
 * plugin-served path, so the validator rejects them instead of failing later
 * with a transport 413.
 */
export const VOICE_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_PLUGIN_TRANSCRIPTION_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Single source of truth for the "large-audio service" bitrate policy: the
 * browser pins a low opus bitrate only when the active transcription service
 * accepts more than the default ceiling, so long recordings stay small. An
 * unknown service (null cap) uses the browser default. Client and server must
 * both go through here instead of re-implementing the tripwire.
 */
export function isLargeAudioService(
  effectiveCapBytes: number | null,
): boolean {
  return (
    effectiveCapBytes !== null &&
    effectiveCapBytes > DEFAULT_PLUGIN_TRANSCRIPTION_MAX_BYTES
  );
}

const DECIMAL_INTEGER = /^\d+$/;

/** Shared grammar check so UI, CLI, and server agree on what an integer is. */
export function isDecimalIntegerString(rawValue: string): boolean {
  return DECIMAL_INTEGER.test(rawValue.trim());
}

function parseDecimalInteger(
  name: string,
  rawValue: string,
  unit: string,
): number {
  const trimmed = rawValue.trim();
  if (!DECIMAL_INTEGER.test(trimmed)) {
    throw new Error(`${name} must be a positive integer of ${unit}`);
  }
  return Number(trimmed);
}

export function validatePluginTranscriptionMaxBytes(
  name: string,
  value: number,
): number {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > VOICE_TRANSCRIPTION_MAX_BYTES
  ) {
    throw new Error(
      `${name} must be a positive integer of bytes no greater than ${VOICE_TRANSCRIPTION_MAX_BYTES} (10MB)`,
    );
  }
  return value;
}

export function parsePluginTranscriptionMaxBytes(
  name: string,
  rawValue: string,
): number {
  return validatePluginTranscriptionMaxBytes(
    name,
    parseDecimalInteger(name, rawValue, "bytes"),
  );
}

const BYTES_PER_MB = 1024 * 1024;

/**
 * Default recorder bitrate (bits/second) pinned for large-audio transcription
 * services. ~32kbps opus keeps 10 minutes of speech near 2.4MB raw while the
 * 16kHz-mono transcription pipeline makes the quality cost negligible.
 */
export const DEFAULT_VOICE_RECORDING_BITRATE = 32_000;
export const VOICE_RECORDING_BITRATE_MIN = 8_000;
export const VOICE_RECORDING_BITRATE_MAX = 320_000;

export function validateVoiceRecordingBitrate(
  name: string,
  value: number,
): number {
  if (
    !Number.isInteger(value) ||
    value < VOICE_RECORDING_BITRATE_MIN ||
    value > VOICE_RECORDING_BITRATE_MAX
  ) {
    throw new Error(
      `${name} must be an integer between ${VOICE_RECORDING_BITRATE_MIN} and ${VOICE_RECORDING_BITRATE_MAX} bits per second`,
    );
  }
  return value;
}

export function parseVoiceRecordingBitrate(
  name: string,
  rawValue: string,
): number {
  return validateVoiceRecordingBitrate(
    name,
    parseDecimalInteger(name, rawValue, "bits per second"),
  );
}

/**
 * Per-attempt timeout floor. Short clips keep this budget so a genuinely stuck
 * backend still fails fast; longer recordings scale above it.
 */
export const VOICE_TRANSCRIPTION_TIMEOUT_FLOOR_MS = 10_000;

/**
 * Budget allowed per megabyte of input audio. Local transcription runs at
 * roughly realtime * a small factor plus fixed model-load and ffmpeg overhead,
 * so budget grows with recording length (approximated from byte size). Short
 * clips whose per-megabyte estimate falls below the floor use the floor.
 */
export const VOICE_TRANSCRIPTION_TIMEOUT_MS_PER_MB = 15_000;

/** Default ceiling on the per-attempt timeout, before user override (5 min). */
export const DEFAULT_VOICE_TRANSCRIPTION_TIMEOUT_MAX_MS = 300_000;

/** Hard upper bound on the configurable per-attempt timeout ceiling (15 min). */
export const VOICE_TRANSCRIPTION_TIMEOUT_MAX_CEILING_MS = 900_000;

export function validateVoiceTranscriptionTimeoutMaxMs(
  name: string,
  value: number,
): number {
  if (
    !Number.isInteger(value) ||
    value < VOICE_TRANSCRIPTION_TIMEOUT_FLOOR_MS ||
    value > VOICE_TRANSCRIPTION_TIMEOUT_MAX_CEILING_MS
  ) {
    throw new Error(
      `${name} must be an integer between ${VOICE_TRANSCRIPTION_TIMEOUT_FLOOR_MS} and ${VOICE_TRANSCRIPTION_TIMEOUT_MAX_CEILING_MS} milliseconds`,
    );
  }
  return value;
}

export function parseVoiceTranscriptionTimeoutMaxMs(
  name: string,
  rawValue: string,
): number {
  return validateVoiceTranscriptionTimeoutMaxMs(
    name,
    parseDecimalInteger(name, rawValue, "milliseconds"),
  );
}

interface ResolveVoiceTranscriptionTimeoutArgs {
  audioBytes: number;
  maxMs: number;
}

/**
 * Per-attempt transcription timeout scaled from the input audio size: a
 * per-megabyte estimate, floored for short clips and clamped to the configured
 * ceiling. Setting the ceiling to the floor opts out of scaling.
 */
export function resolveVoiceTranscriptionTimeoutMs(
  args: ResolveVoiceTranscriptionTimeoutArgs,
): number {
  const scaled = Math.ceil(
    (Math.max(0, args.audioBytes) / BYTES_PER_MB) *
      VOICE_TRANSCRIPTION_TIMEOUT_MS_PER_MB,
  );
  const ceiling = Math.max(VOICE_TRANSCRIPTION_TIMEOUT_FLOOR_MS, args.maxMs);
  return Math.min(
    Math.max(scaled, VOICE_TRANSCRIPTION_TIMEOUT_FLOOR_MS),
    ceiling,
  );
}
