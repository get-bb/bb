export interface SealedSocket {
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen: (() => void) | null;
  onMessage: ((data: Uint8Array) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
  onError: ((error: Error) => void) | null;
}

export type SealedSocketFactory = (url: string) => SealedSocket;

export const CONTROL_PREFIX = 0;

export interface ControlMessage {
  type: "ping" | "pong";
}

export function encodeControl(message: ControlMessage): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(message));
  const out = new Uint8Array(1 + json.length);
  out[0] = CONTROL_PREFIX;
  out.set(json, 1);
  return out;
}

export function decodeControl(plaintext: Uint8Array): ControlMessage | null {
  if (plaintext.length === 0 || plaintext[0] !== CONTROL_PREFIX) return null;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(plaintext.subarray(1)),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      ((parsed as { type?: unknown }).type === "ping" ||
        (parsed as { type?: unknown }).type === "pong")
    ) {
      return parsed as ControlMessage;
    }
  } catch {}
  return null;
}
