import type { z } from "zod";

export function decodeSocketPayload(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString(
      "utf8",
    );
  }
  return String(raw);
}

export function parseSocketMessage<T>(
  socket: { close(code?: number, reason?: string): void },
  raw: unknown,
  schema: z.ZodType<T>,
): T | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeSocketPayload(raw));
  } catch {
    socket.close(1008, "invalid-message");
    return null;
  }

  return parseSocketValue(socket, decoded, schema);
}

export function parseSocketValue<T>(
  socket: { close(code?: number, reason?: string): void },
  value: unknown,
  schema: z.ZodType<T>,
): T | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    socket.close(1008, "invalid-message");
    return null;
  }
  return result.data;
}
