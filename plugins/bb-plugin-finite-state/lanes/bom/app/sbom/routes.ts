const MAX_COMPONENT_KEY_LENGTH = 512;
const MAX_ROUTE_SEGMENT_LENGTH = 768;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type BomRoute =
  | { tab: "software"; componentKey?: string; savedView?: string }
  | { tab: "hardware"; partId?: string; screen?: "review" | "ingest" };

export class BomRouteError extends Error {
  readonly code = "BAD_ROUTE" as const;

  constructor(message: string) {
    super(message);
    this.name = "BomRouteError";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeComponentRouteKey(componentKey: string): string {
  if (
    componentKey.length === 0 ||
    componentKey.length > MAX_COMPONENT_KEY_LENGTH
  ) {
    throw new BomRouteError("The component key has an invalid length.");
  }
  return bytesToBase64(new TextEncoder().encode(componentKey))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeComponentRouteKey(segment: string): string {
  if (
    segment.length === 0 ||
    segment.length > MAX_ROUTE_SEGMENT_LENGTH ||
    !BASE64URL_PATTERN.test(segment)
  ) {
    throw new BomRouteError("The component route key is invalid.");
  }
  try {
    const padding = "=".repeat((4 - (segment.length % 4)) % 4);
    const bytes = base64ToBytes(
      `${segment.replaceAll("-", "+").replaceAll("_", "/")}${padding}`,
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      decoded.length === 0 ||
      decoded.length > MAX_COMPONENT_KEY_LENGTH ||
      encodeComponentRouteKey(decoded) !== segment
    ) {
      throw new BomRouteError("The component route key is invalid.");
    }
    return decoded;
  } catch (error) {
    if (error instanceof BomRouteError) throw error;
    throw new BomRouteError("The component route key is invalid.");
  }
}

function decodeRouteLabel(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value.length > 0 && value.length <= 200 ? value : null;
  } catch {
    return null;
  }
}

export function parseBomSubPath(
  subPath: string | undefined,
): BomRoute | null {
  const segments = (subPath ?? "")
    .split("/")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return { tab: "software" };
  if (segments[0] === "software") {
    if (segments.length === 1) return { tab: "software" };
    if (segments.length === 2) {
      try {
        return {
          tab: "software",
          componentKey: decodeComponentRouteKey(segments[1]!),
        };
      } catch {
        return null;
      }
    }
    if (segments.length === 3 && segments[1] === "view") {
      const savedView = decodeRouteLabel(segments[2]!);
      return savedView ? { tab: "software", savedView } : null;
    }
    return null;
  }
  if (segments[0] !== "hardware") return null;
  if (segments.length === 1) return { tab: "hardware" };
  if (segments.length === 2 && (segments[1] === "review" || segments[1] === "ingest")) {
    return { tab: "hardware", screen: segments[1] };
  }
  if (segments.length === 2) {
    const partId = decodeRouteLabel(segments[1]!);
    return partId ? { tab: "hardware", partId } : null;
  }
  return null;
}

export function componentSubPath(componentKey: string): string {
  return `software/${encodeComponentRouteKey(componentKey)}`;
}
