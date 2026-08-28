type SocketPayloadInput = Parameters<typeof String>[0];

export function decodeSocketPayload(raw: SocketPayloadInput): string {
  if (Object.prototype.toString.call(raw) === "[object String]") {
    return String(raw);
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
