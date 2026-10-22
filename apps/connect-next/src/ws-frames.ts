const HEAD_END = Buffer.from("\r\n\r\n");
export const WEBSOCKET_GOING_AWAY = Buffer.from([0x88, 0x02, 0x03, 0xe9]);

export interface ServerFrameTracker {
  observe(chunk: Buffer): void;
  closing(): Buffer;
}

export function trackServerFrames(): ServerFrameTracker {
  let phase: "head" | "header" | "payload" = "head";
  let headTail = Buffer.alloc(0);
  let header = Buffer.alloc(0);
  let remaining = 0;

  function headerLength(bytes: Buffer): number | null {
    if (bytes.length < 2) return null;
    const second = bytes[1] ?? 0;
    const short = second & 0x7f;
    const mask = second & 0x80 ? 4 : 0;
    const extended = short === 126 ? 2 : short === 127 ? 8 : 0;
    const total = 2 + extended + mask;
    return bytes.length >= total ? total : null;
  }

  function payloadLength(bytes: Buffer): number {
    const short = (bytes[1] ?? 0) & 0x7f;
    if (short === 126) return bytes.readUInt16BE(2);
    if (short === 127) return Number(bytes.readBigUInt64BE(2));
    return short;
  }

  function frames(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (phase === "payload") {
        const take = Math.min(remaining, chunk.length - offset);
        remaining -= take;
        offset += take;
        if (remaining === 0) phase = "header";
        continue;
      }
      header = Buffer.concat([header, chunk.subarray(offset, offset + 1)]);
      offset += 1;
      const length = headerLength(header);
      if (length === null) continue;
      remaining = payloadLength(header);
      header = Buffer.alloc(0);
      phase = remaining === 0 ? "header" : "payload";
    }
  }

  return {
    observe(chunk) {
      if (phase !== "head") {
        frames(chunk);
        return;
      }
      const joined = Buffer.concat([headTail, chunk]);
      const end = joined.indexOf(HEAD_END);
      if (end === -1) {
        headTail = joined.subarray(Math.max(0, joined.length - 3));
        return;
      }
      phase = "header";
      headTail = Buffer.alloc(0);
      frames(joined.subarray(end + HEAD_END.length));
    },
    closing() {
      if (phase === "head") return Buffer.alloc(0);
      if (phase === "payload") {
        return Buffer.concat([Buffer.alloc(remaining), WEBSOCKET_GOING_AWAY]);
      }
      if (header.length > 0) return Buffer.alloc(0);
      return WEBSOCKET_GOING_AWAY;
    },
  };
}
